## Polkadot Staking Rewards


### Getting Started

```
cp config.sample.json config.json
```

Fill out the specifed fields:

```
{
    "priceCurrencyType": "<CURRENCY_TYPE>", // The currency prices are in. E.G. "usd", "gbp", "eur", etc. full list: https://www.coingecko.com/api/documentations/v3#/simple/get_simple_supported_vs_currencies
    "volumeCurrencyType": "<CURRENCY_TYPE", // Same as above. This is the volume at the time of rewards
    "from": "<YYYY.MM.DD>", // Starting date of rewards
    "to": "<YYYYY.MM.DD>", // End date of rewards
    "accounts": [
        {
            "name": "<NAME>", // Name you want to give the account
            "address": "<Address>", // Stash address of the validator or nominator
            "role": "<ROLLE>" // either "nominator" or "validator"
          }
    ]
}
```


```
yarn install
```

```
node index.js
```