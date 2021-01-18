const fetch = require('node-fetch');
const fs = require('fs');
const { ApiPromise, WsProvider } = require('@polkadot/api');
const config = require('./config.json');

const url = 'https://polkadot.subscan.io/api/scan/account/reward_slash';
const NEWLINE = '\r\n';

const getRewardData = async(address, priceData, volumeData, api) => {
    console.log(`Fetching reward data for ${address}`);

    let page = 0;
    let shouldContinue = true;
    let txListAll = [];

    while (shouldContinue){
        console.log(`Querying SubScan page: ${page}...`)
        const response = await fetch(url, {
            method: 'post',
            body: JSON.stringify({
                row: 100,
                page: page,
                address: address
            }),
            headers: {'Content-Type': 'application/json'}
        });
        const json = await response.json();
        const txList = json.data.list;
        if (txList.length == 0){
            shouldContinue = false;
        } else {
            txListAll = txListAll.concat(txList);
            page+=1;
        }
    }

    console.log('Querying chain...')
    txListAll = await Promise.all(
        txListAll
            .filter(tx => {
                if (parseInt(tx.amount) > 0 && tx.block_timestamp > new Date(config.from).getTime() / 1000 && tx.block_timestamp < new Date(config.to).getTime() / 1000) return tx;
                })
            .map(async(tx) => {
                const blockNumber = tx.block_num;
                const prevHash = await api.rpc.chain.getBlockHash(blockNumber);
                const bal = parseInt(Number((await api.query.system.account.at(prevHash, address)).toJSON().data.free), 10) / Math.pow(10,10);
                const bonded = parseInt(Number((await api.query.staking.ledger.at(prevHash, address)).toJSON().active), 10) / Math.pow(10,10);

                return {
                    'date': new Date(tx.block_timestamp * 1000).toLocaleDateString('en-GB'),
                    'block_num': `"=HYPERLINK(""https://polkadot.subscan.io/block/${tx.block_num}"", ""${tx.block_num}"")"`,
                    'extrinsic_event': `"=HYPERLINK(""https://polkadot.subscan.io/extrinsic/${tx.extrinsic_hash}?event=${tx.block_num}-${tx.event_idx}"", ""${tx.block_num}-${tx.event_idx}"")"`,
                    'block_timestamp': tx.block_timestamp,
                    'reward_amount': parseInt(tx.amount) / Math.pow(10,10),
                    'price': getDayData(tx.block_timestamp, priceData),
                    'volume': getDayData(tx.block_timestamp, volumeData),
                    'balance': bal,
                    'bonded': bonded
                }
            
            }));
        return txListAll;
    }
    
    

const getNominationData = async(address, api) =>{
    console.log('Getting nomination data....');
    const nominations = (await api.query.staking.nominators(address)).toJSON();
    if (!nominations){
        return {
            "targets": [],
            "era": 0
        };
    }

    let targets = nominations.targets;
    const era = nominations.submittedIn;
    targets = await Promise.all(targets.map(async(target)=>{
        let identity;
        for (const account of config.accounts){
            if (account.address == target){
                identity = account.name;
            }
        }
        if (!identity){
            const onChainIdentity = await getIdentity(target, api);
            if (onChainIdentity.name == target){
                identity = target;
            } else {
                identity = onChainIdentity.sub ? `${onChainIdentity.name} / ${onChainIdentity.sub}` : onChainIdentity.name; 
            }
        }
        
        return {
            "address": target,
            "identity": identity,
            "identityLink": `"=HYPERLINK(""https://polkadot.subscan.io/account/${target}"", ""${target}"")"`
        };
    }));
    return {
        "targets": targets,
        "era": era
    }
}

const getIdentity = async (addr, api) => {
    let identity, verified, sub;
    identity = (await api.query.identity.identityOf(addr));
    if (!identity.isSome) {

        identity = await api.query.identity.superOf(addr);
        if (!identity.isSome)  return {name: addr, verified: false, sub: null};

        const subRaw = identity.toJSON()[1].Raw;
        if (subRaw && subRaw.substring(0, 2) === '0x'){
            sub = hex2a(subRaw.substring(2));
        } else { sub = subRaw;}
        const superAddress = identity.toJSON()[0];
        identity = await api.query.identity.identityOf(superAddress);
    }

    const raw = identity.toJSON().info.display.Raw;
    const { judgements } = identity.unwrap();
    for (const judgement of judgements) {
        const status = judgement[1];
        verified = status.isReasonable || status.isKnownGood;
    }
      
    if (raw && raw.substring(0, 2) === '0x'){
        return { name: hex2a(raw.substring(2)), verified: verified, sub: sub};
    } else return {name: raw, verified: verified, sub: sub} ;
  }

  const hex2a = (hex) => {
    return decodeURIComponent('%' + hex.match(/.{1,2}/g).join('%'));
  }


const writeCSV = async (txListAll, account, stakingData) =>{

    // Returns the abbreviated name, with any whole number. For example, Big Bag Holder Stash 223 should be BBHS223
    var nameAbbreviation = account.name.split(' ').map((item)=>{ return  /^-?\d+$/.test(item) ? item : item[0]}).join('');

    const filename = `./CSVs/${nameAbbreviation}-${account.address}.csv`;
    console.log(`Writing data for ${account.name} to ${filename}...`);

    (async () => {

        const address = `Adrress:, ${account.address}` + NEWLINE;
        fs.writeFileSync(filename, address);

        const name = `Name:, ${account.name}` + NEWLINE ;
        fs.appendFileSync(filename, name);

        const role = `Role:, ${account.role.charAt(0).toUpperCase()+account.role.slice(1)}` + NEWLINE + NEWLINE;
        fs.appendFileSync(filename, role);

        if (stakingData){
            const stakingHeading = `Nominating:` + NEWLINE ;
            fs.appendFileSync(filename, stakingHeading);

            const stakingHeading2 = `Nominating Since (Era), Name / Identity, Address` + NEWLINE ;
            fs.appendFileSync(filename, stakingHeading2);
            for (const validator of stakingData.targets){
                const val = `${stakingData.era}, ${validator.identity}, ${validator.identityLink}` + NEWLINE ;
                fs.appendFileSync(filename, val);
            }
            
            fs.appendFileSync(filename, NEWLINE);

        }

        // Write TX Reward List Headers
        const headers = `Date, Block Number, Extrinsic Event, Block Timestamp, Reward Amount (DOTs), Price (${config.priceCurrencyType}), Volume (${config.volumeCurrencyType}), Balance at Block, Bonded at Block` + '\r\n';
        fs.appendFileSync(filename, headers);

        for (const tx of txListAll){
            const txData = `${tx.date}, ${tx.block_num}, ${tx.extrinsic_event}, ${tx.block_timestamp}, ${tx.reward_amount}, ${tx.price}, ${tx.volume}, ${tx.balance}, ${tx.bonded}` + NEWLINE;
            fs.appendFileSync(filename, txData);
        }

      })();
      console.log(`Wrote data for ${account.name}`);
}


const getPriceData = async(currencyType, from, to) => {
    console.log(`Getting Price Data in ${currencyType} from ${from} to ${to}`);

    const response = await fetch(`https://api.coingecko.com/api/v3/coins/polkadot/market_chart/range?vs_currency=${currencyType}&from=${from}&to=${to + 86400000}`, {
        method: 'get',
        headers: {'Content-Type': 'application/json'}
    });
    const json = await response.json();
    return json.prices;
}

const getVolumeData = async(currencyType, from, to) => {
    console.log(`Getting Volume Data in ${currencyType} from ${from} to ${to}`);

    const response = await fetch(`https://api.coingecko.com/api/v3/coins/polkadot/market_chart/range?vs_currency=${currencyType}&from=${from}&to=${to + 86400000}`, {
        method: 'get',
        headers: {'Content-Type': 'application/json'}
    });
    const json = await response.json();

    return json.total_volumes;
}

// Gets the corresponding days data from a list of unix times
const getDayData = (time, list) => {

    if (list[0][0] / Math.pow(10,3) > time){
        return 0;
    }

    let prev;
    for (const item of list){
        const unixtime = item[0] / Math.pow(10,3);
        const value = item[1];

        if (unixtime >time){
            return value;
        } else {
            prev = unixtime;
        }
    }
}


const main = async() => {
    console.log('Starting...');

    const fromDate = new Date(config.from).getTime() / 1000;
    const toDate = new Date(config.to).getTime() / 1000;

    const provider = new WsProvider('wss://rpc.polkadot.io');
    // Create the API and wait until ready
    const api = await ApiPromise.create({ provider });
    const [chain, nodeName, nodeVersion] = await Promise.all([
        api.rpc.system.chain(),
        api.rpc.system.name(),
        api.rpc.system.version()
      ]);
    
      console.log(`You are connected to chain ${chain} using ${nodeName} v${nodeVersion}`);


    const priceData = await getPriceData(config.priceCurrencyType, fromDate, toDate);
    const volumeData = await getVolumeData(config.volumeCurrencyType, fromDate, toDate);

    for (const account of config.accounts){
        console.log('------------------------------------------------------------------------------');
        console.log(`Getting txs for ${account.name}`);
        const txList = await getRewardData(account.address, priceData, volumeData, api);

        if (account.role == 'nominator'){
            const stakingData = await getNominationData(account.address, api);
            writeCSV(txList, account, stakingData);
        } else {
            writeCSV(txList, account, null);
        }
    }
    console.log('------------------------------------------------------------------------------');
}


try {
    main().finally(() => process.exit());;
  } catch (e) {
    console.error(e);
  }


