//  ---------------------------------------------------------------------------

import Exchange from './abstract/cube.js';
import { BadRequest, AuthenticationError, InsufficientFunds, InvalidOrder, ArgumentsRequired, PermissionDenied, ExchangeError, RateLimitExceeded, ExchangeNotAvailable, RequestTimeout, OrderNotFound } from './base/errors.js';
import { Precise } from './base/Precise.js';
import { sha256 } from './static_dependencies/noble-hashes/sha256.js';
import { hmac } from './static_dependencies/noble-hashes/hmac';
import * as utils from './static_dependencies/noble-hashes/utils';
import type { Balances, Dict, Int, Market, Num, OHLCV, Order, OrderBook, OrderSide, OrderType, Str, Strings, Ticker, Tickers, Trade, int, Position } from './base/types.js';

//  ---------------------------------------------------------------------------

/**
 * @class ace
 * @augments Exchange
 */
export default class cube extends Exchange {
    describe () {
        return this.deepExtend(super.describe(), {
            'id': 'cube',
            'name': 'Cube Exchange',
            'countries': ['US'],
            'rateLimit': 1000,
            'proxyUrl': undefined,
            'has': {
                'fetchMarkets': true,
                'fetchTicker': true,
                'fetchOrderBook': true,
                'fetchOHLCV': true,
                'fetchWithdrawals': true,
                'fetchDeposits': true,
                'fetchTransfers': true,
                'fetchPositions': true,
                'fetchBalance': true,
                'fetchOrders': true,
                'withdraw': true,
                'fetchSubaccounts': true,
                'fetchMyTrades': true,
            },
            timeframes: {
                '1s': '1s',
                '1m': '1m',
                '15m': '15m',
                '1h': '1h',
                '4h': '4h',
                '1d': '1d',
                '7d': '7d',
            },
            'urls': {
                'api': {
                    'public': 'https://api.cube.exchange/md/v0',
                    'private': 'https://api.cube.exchange/ir/v0',
                },
                'www': 'https://www.cube.exchange',
                'doc': 'https://docs.cube.exchange',
            },
            'api': {
                'public': {
                    'get': [
                        'tickers/snapshot',
                        'parsed/tickers',
                        'parsed/book/{market_id}/snapshot',
                        'parsed/book/{market_id}/recent-trades',
                        'history/klines',
                        'fetchBookSnapshot'
                    ],
                },
                'private': {
                    'get': [
                        'markets',
                        'history/klines',
                        'users/me',
                        'users/subaccounts',
                        'users/subaccount/{subaccount_id}/positions',
                        'users/subaccount/{subaccount_id}/transfers',
                        'users/subaccount/{subaccount_id}/withdrawals',
                        'users/subaccount/{subaccount_id}/deposits',
                        'users/subaccount/{subaccount_id}/orders',
                        'users/address',
                        'users/subaccount/{subaccount_id}/orders/{order_id}',
                    ],
                    'post': [
                        'orders',
                        'users/withdraw',
                    ],
                    
                    'delete': [
                        'orders/{order_id}',
                    ],
                },
            },
            'requiredCredentials': {
                'apiKey': true,
                'secret': true,
            },
            'exceptions': {
                'exact': {
                    '401': AuthenticationError,
                    '400': BadRequest,
                    '403': PermissionDenied,
                    '404': ExchangeError,
                    '429': RateLimitExceeded,
                    '500': ExchangeNotAvailable,
                    '503': ExchangeNotAvailable,
                    '504': RequestTimeout,
                },
                'broad': {
                    'Invalid API key': AuthenticationError,
                    'Order not found': OrderNotFound,
                    'Insufficient balance': InsufficientFunds,
                    'Rate limit exceeded': RateLimitExceeded,
                },
            },
        });
    }
    
    async fetchMarkets (params = {}): Promise<Market[]> {
        try {
            const url = 'https://api.cube.exchange/ir/v0/markets';
            const response = await this.fetch(url);
            const result = this.safeValue(response, 'result', {});
            
            const markets = this.safeValue(result, 'markets', []);
            const assets = this.safeValue(result, 'assets', []);
            const feeTables = this.safeValue(result, 'feeTables', []);
    
            const assetsById = this.indexBy(assets, 'assetId');
            const feeTablesById = this.indexBy(feeTables, 'feeTableId');
    
            return markets.map(market => this.parseMarket(market, { assetsById, feeTablesById }));
        } catch (error) {
            console.error('Error fetching markets:', error);
            throw error;
        }
    }
    
    parseMarket (market, params = {}): Market {
        const assetsById = this.safeValue(params, 'assetsById', {});
        const feeTablesById = this.safeValue(params, 'feeTablesById', {});
    
        const id = this.safeString(market, 'marketId');
        const baseAssetId = this.safeString(market, 'baseAssetId');
        const quoteAssetId = this.safeString(market, 'quoteAssetId');
        const baseAsset = this.safeValue(assetsById, baseAssetId, {});
        const quoteAsset = this.safeValue(assetsById, quoteAssetId, {});
        const base = this.safeCurrencyCode(this.safeString(baseAsset, 'symbol'));
        const quote = this.safeCurrencyCode(this.safeString(quoteAsset, 'symbol'));
        const symbol = this.safeString(market, 'symbol', base + '/' + quote);
    
        const feeTableId = this.safeString(market, 'feeTableId');
        const feeTable = this.safeValue(feeTablesById, feeTableId, {});
        const feeTiers = this.safeValue(feeTable, 'feeTiers', []);
        const firstTier = this.safeValue(feeTiers, 0, {});
    
        return {
            'id': id,
            'symbol': symbol,
            'base': base,
            'quote': quote,
            'settle': undefined,
            'baseId': baseAssetId,
            'quoteId': quoteAssetId,
            'settleId': undefined,
            'type': 'spot',
            'spot': true,
            'margin': false,
            'swap': false,
            'future': false,
            'option': false,
            'active': this.safeInteger(market, 'status') === 1,
            'contract': false,
            'linear': undefined,
            'inverse': undefined,
            'taker': this.safeNumber(firstTier, 'takerFeeRatio'),
            'maker': this.safeNumber(firstTier, 'makerFeeRatio'),
            'contractSize': undefined,
            'expiry': undefined,
            'expiryDatetime': undefined,
            'strike': undefined,
            'optionType': undefined,
            'created': undefined,
            'precision': {
                'amount': this.safeNumber(market, 'quantityTickSize'),
                'price': this.safeNumber(market, 'priceTickSize'),
            },
            'limits': {
                'leverage': {
                    'min': undefined,
                    'max': undefined,
                },
                'amount': {
                    'min': this.safeNumber(market, 'minOrderQty'),
                    'max': undefined,
                },
                'price': {
                    'min': undefined,
                    'max': undefined,
                },
                'cost': {
                    'min': undefined,
                    'max': undefined,
                },
            },
            'info': market,
        };
    }
        
    async fetchTicker (symbol: string, params = {}): Promise<Ticker> {
        await this.loadMarkets();
        const market = this.market(symbol);
        const request = {
            'market_symbol': market['id'],
        };
        const response = await this.publicGetParsedTickers(this.extend(request, params));
        const tickers = this.safeValue(response, 'result', []);
        const ticker = this.safeValue(tickers, 0);
        if (ticker === undefined) {
            throw new ExchangeError(this.id + ' fetchTicker() could not find a ticker for ' + symbol);
        }
        return this.parseTicker(ticker, market);
    }

    parseTicker (ticker, market = undefined): Ticker {
        const marketId = this.safeString(ticker, 'ticker_id');
        const symbol = this.safeSymbol(marketId, market);
        const timestamp = this.safeInteger(ticker, 'timestamp');
        const last = this.safeNumber(ticker, 'last_price');
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'high': this.safeNumber(ticker, 'high'),
            'low': this.safeNumber(ticker, 'low'),
            'bid': this.safeNumber(ticker, 'bid'),
            'bidVolume': undefined,
            'ask': this.safeNumber(ticker, 'ask'),
            'askVolume': undefined,
            'vwap': undefined,
            'open': this.safeNumber(ticker, 'open'),
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': this.safeNumber(ticker, 'base_volume'),
            'quoteVolume': this.safeNumber(ticker, 'quote_volume'),
            'info': ticker,
        };
    }

    async fetchOrderBook (symbol: string, limit: number = undefined, params = {}): Promise<OrderBook> {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'market_id': market['id'],
        };
        if (limit !== undefined) {
            request['limit'] = limit; // Add this only if the API supports a limit parameter
        }
        const response = await this.publicGetParsedBookMarketIdSnapshot (this.extend (request, params));
        // Example response:
        // {
        //   "result": {
        //     "asks": [
        //       [
        //         2467.94,
        //         0.64
        //       ],
        //       [
        //         2468.19,
        //         4.0527
        //       ],
        //       [
        //         2468.56,
        //         0.25
        //       ],
        //       [
        //         2468.84,
        //         2.7483
        //       ]
        //     ],
        //     "bids": [
        //       [
        //         2467.46,
        //         4.0535
        //       ],
        //       [
        //         2467.43,
        //         0.64
        //       ],
        //       [
        //         2467.31,
        //         0.25
        //       ]
        //     ],
        //     "ticker_id": "ETHUSDC",
        //     "timestamp": 1726781837802
        //   }
        // }
    const result = this.safeValue (response, 'result', {});
    const timestamp = this.safeInteger (result, 'timestamp');
    return this.parseOrderBook (result, symbol, timestamp, 'bids', 'asks', 0, 1);
}

    async fetchOHLCV (symbol: string, timeframe = '1m', since: number = undefined, limit: number = undefined, params = {}): Promise<OHLCV[]> {
        /**
         * @method
         * @name cube#fetchOHLCV
         * @description fetches historical candlestick data containing the open, high, low, and close price, and the volume of a market
         * @param {string} symbol unified symbol of the market to fetch OHLCV data for
         * @param {string} timeframe the length of time each candle represents
         * @param {int} [since] timestamp in ms of the earliest candle to fetch
         * @param {int} [limit] the maximum amount of candles to fetch
         * @param {object} [params] extra parameters specific to the cube api endpoint
         * @returns {OHLCV[]} A list of candles ordered as timestamp, open, high, low, close, volume
         */
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'market_id': market['id'],
            'interval': this.timeframes[timeframe],
        };
        if (since !== undefined) {
            request['start_time'] = since;
        }
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const response = await this.publicGetHistoryKlines (this.extend (request, params));
        //
        //     {
        //         "result": [
        //             [1710944100, 17263, 17509, 17247, 17459, "23107"],
        //             [1710943200, 17203, 17314, 17156, 17260, "55426"]
        //         ]
        //     }
        //
        const data = this.safeValue (response, 'result', []);
        return this.parseOHLCVs (data, market, timeframe, since, limit);
    }
    
    parseOHLCV (ohlcv, market = undefined): OHLCV {
        //
        //     [1710944100, 17263, 17509, 17247, 17459, "23107"]
        //
        return [
            this.safeTimestamp (ohlcv, 0),      // timestamp
            this.safeNumber (ohlcv, 1),         // open
            this.safeNumber (ohlcv, 2),         // high
            this.safeNumber (ohlcv, 3),         // low
            this.safeNumber (ohlcv, 4),         // close
            this.safeNumber (ohlcv, 5),         // volume
        ];
    }

    async fetchSubaccounts (params = {}) {
        /**
         * @method
         * @name cube#fetchSubaccounts
         * @description fetch all subaccounts for the authenticated account
         * @param {object} params extra parameters specific to the cube api endpoint
         * @returns {object[]} an array of subaccount objects
         */
        const response = await this.privateGetUsersSubaccounts (params);
        //
        //     {
        //         "result": {
        //             "ids": [
        //                 1,
        //                 2,
        //                 3
        //             ]
        //         }
        //     }
        //
        const result = this.safeValue (response, 'result', {});
        const subaccounts = this.safeValue (result, 'ids', []);
        return subaccounts.map ((id) => {
            return {
                'id': id,
                'type': 'subaccount',
            };
        });
    }

    async fetchPositions (symbols: string[] = undefined, params = {}): Promise<Position[]> {
        await this.loadMarkets ();
        const subaccountId = this.safeInteger (params, 'subaccountId');
        if (subaccountId === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchPositions() requires a subaccountId parameter');
        }
        params = this.omit (params, 'subaccountId');
        const request = {
            'subaccount_id': subaccountId,
        };
        const response = await this.privateGetUsersSubaccountSubaccountIdPositions (this.extend (request, params));
        const result = this.safeValue (response, 'result', {});
        const subaccountPositions = this.safeValue (result, subaccountId.toString(), {});
        const innerPositions = this.safeValue (subaccountPositions, 'inner', []);
        return this.parsePositions (innerPositions, symbols);
    }
    
    parsePosition (position, market = undefined): Position {
        const assetId = this.safeString (position, 'assetId');
        market = this.safeMarket (assetId, market);
        const symbol = market['symbol'];
        const amount = this.safeString (position, 'amount');
        return {
            'info': position,
            'symbol': symbol,
            'timestamp': undefined,
            'datetime': undefined,
            'initialMargin': undefined,
            'initialMarginPercentage': undefined,
            'maintenanceMargin': undefined,
            'maintenanceMarginPercentage': undefined,
            'entryPrice': undefined,
            'notional': amount,
            'leverage': undefined,
            'unrealizedPnl': undefined,
            'contracts': undefined,
            'contractSize': undefined,
            'marginRatio': undefined,
            'liquidationPrice': undefined,
            'markPrice': undefined,
            'collateral': amount,
            'marginType': undefined,
            'side': undefined,
            'percentage': undefined,
        };
    }

    async fetchTransfers (code: string = undefined, since: number = undefined, limit: number = undefined, params = {}) {
        await this.loadMarkets ();
        const subaccountId = this.safeInteger (params, 'subaccountId');
        if (subaccountId === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchTransfers() requires a subaccountId parameter');
        }
        params = this.omit (params, 'subaccountId');
        const request = {
            'subaccount_id': subaccountId,
        };
        const response = await this.privateGetUsersSubaccountSubaccountIdTransfers (this.extend (request, params));
        //
        //     {
        //       "result": {
        //         "inner": [
        //           {
        //             "amount": "220000000",
        //             "approved": true,
        //             "assetId": 5,
        //             "attemptId": 134,
        //             "createdAt": "2023-07-30T14:30:00-05:00",
        //             "fromAddress": "2CakzUzWpQKmx9GGexMMRTtRcjtSdjCRB68vpUKM4obk",
        //             "fromSubaccountId": 8,
        //             "toAddress": "8j5i8msVWLkTP2ff3bmTLK3k2m3XtW1zdJPYovon55YS",
        //             "toSubaccountId": 9,
        //             "txnHash": "3ojghQjhimYEiFCyy6bGvJsRnX54X1rHuR1eBhVHdF4z",
        //             "txnIndex": 0,
        //             "txnState": "pending"
        //           }
        //         ],
        //         "name": "primary account"
        //       }
        //     }
        //
        const result = this.safeValue (response, 'result', {});
        const transfers = this.safeValue (result, 'inner', []);
        return this.parseTransfers (transfers, code, since, limit);
    }
    
    parseTransfer (transfer, currency = undefined) {
        const amount = this.safeString (transfer, 'amount');
        const assetId = this.safeString (transfer, 'assetId');
        const fromAddress = this.safeString (transfer, 'fromAddress');
        const toAddress = this.safeString (transfer, 'toAddress');
        const timestamp = this.parse8601 (this.safeString (transfer, 'createdAt'));
        const txid = this.safeString (transfer, 'txnHash');
        const status = this.parseTransferStatus (this.safeString (transfer, 'txnState'));
        return {
            'info': transfer,
            'id': this.safeString (transfer, 'attemptId'),
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'currency': this.safeCurrencyCode (assetId, currency),
            'amount': this.parseNumber (amount),
            'fromAccount': this.safeString (transfer, 'fromSubaccountId'),
            'toAccount': this.safeString (transfer, 'toSubaccountId'),
            'from': fromAddress,
            'to': toAddress,
            'status': status,
            'txid': txid,
        };
    }
    
    parseTransferStatus (status) {
        const statuses = {
            'pending': 'pending',
            // Add other status mappings as needed
        };
        return this.safeString (statuses, status, status);
    }
    
    async fetchDeposits (code = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const subaccountId = this.safeInteger (params, 'subaccountId');
        if (subaccountId === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchDeposits() requires a subaccountId parameter');
        }
        params = this.omit (params, 'subaccountId');
        const request = {
            'subaccount_id': subaccountId,
        };
        const response = await this.privateGetUsersSubaccountSubaccountIdDeposits (this.extend (request, params));
        //
        //  {
        //    "result": {
        //      "8": {
        //        "inner": [
        //          {
        //            "address": "bcrt1qfsf0tfcw0qvtxnm8qmktwpxpt8v0hk4rawh0n7",
        //            "amount": "1100000000",
        //            "assetId": 1,
        //            "createdAt": "2023-07-30T14:30:00-05:00",
        //            "fiatToCrypto": false,
        //            "kytStatus": "accept",
        //            "txnHash": "faae74ae3700cdea62f51930d489a34f3bc4ee2521a017a9bad72dbd0a5156b4",
        //            "txnIndex": 1,
        //            "txnState": "confirmed",
        //            "updatedAt": "2023-07-30T14:30:00-05:00"
        //          },
        //          // ... more deposits
        //        ],
        //        "name": "primary"
        //      }
        //    }
        //  }
        //
        const result = this.safeValue (response, 'result', {});
        const subaccountData = this.safeValue (result, subaccountId.toString(), {});
        const deposits = this.safeValue (subaccountData, 'inner', []);
        return this.parseDeposits (deposits, code, since, limit);
    }
    
    parseDeposit (deposit, currency = undefined) {
        const address = this.safeString (deposit, 'address');
        const amount = this.safeString (deposit, 'amount');
        const timestamp = this.parse8601 (this.safeString (deposit, 'createdAt'));
        const updated = this.parse8601 (this.safeString (deposit, 'updatedAt'));
        const assetId = this.safeString (deposit, 'assetId');
        const txid = this.safeString (deposit, 'txnHash');
        const status = this.parseDepositStatus (this.safeString (deposit, 'txnState'));
        return {
            'info': deposit,
            'id': undefined,
            'txid': txid,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'address': address,
            'tag': undefined,
            'type': undefined,
            'amount': this.parseNumber (amount),
            'currency': this.safeCurrencyCode (assetId, currency),
            'status': status,
            'updated': updated,
            'network': undefined,
        };
    }
    
    parseDepositStatus (status) {
        const statuses = {
            'confirmed': 'ok',
            // Add other status mappings as needed
        };
        return this.safeString (statuses, status, 'pending');
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const subaccountId = this.safeInteger (params, 'subaccountId');
        if (subaccountId === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchMyTrades() requires a subaccountId parameter');
        }
        params = this.omit (params, 'subaccountId');
        const request = {
            'subaccount_id': subaccountId,
        };
        if (since !== undefined) {
            request['startTime'] = since;
        }
        if (symbol !== undefined) {
            const market = this.market (symbol);
            request['marketIds'] = market['id'];
        }
        const response = await this.privateGetUsersSubaccountSubaccountIdFills (this.extend (request, params));
        //
        //  {
        //    "result": {
        //      "fills": [
        //        {
        //          "aggressingSide": "Ask",
        //          "baseAmount": "3300000",
        //          "feeAmount": "0",
        //          "feeAssetId": 1,
        //          "filledAt": 1720933004211574000,
        //          "marketId": 100004,
        //          "orderId": 610001,
        //          "price": 700000,
        //          "quantity": 3000,
        //          "quoteAmount": "2100000000",
        //          "side": "Bid",
        //          "tradeId": 620011
        //        }
        //      ],
        //      "name": "primary"
        //    }
        //  }
        //
        const result = this.safeValue (response, 'result', {});
        const trades = this.safeValue (result, 'fills', []);
        return this.parseTrades (trades, undefined, since, limit);
    }
    
    parseTrade (trade, market = undefined) {
        const id = this.safeString (trade, 'tradeId');
        const orderId = this.safeString (trade, 'orderId');
        const timestamp = this.safeInteger (trade, 'filledAt');
        const marketId = this.safeString (trade, 'marketId');
        market = this.safeMarket (marketId, market);
        const symbol = market['symbol'];
        const price = this.safeString (trade, 'price');
        const amount = this.safeString (trade, 'quantity');
        const cost = this.safeString (trade, 'quoteAmount');
        const side = this.safeStringLower (trade, 'side');
        const takerOrMaker = (this.safeString (trade, 'aggressingSide') === side) ? 'taker' : 'maker';
        const feeCost = this.safeString (trade, 'feeAmount');
        let fee = undefined;
        if (feeCost !== undefined) {
            const feeCurrencyId = this.safeString (trade, 'feeAssetId');
            const feeCurrencyCode = this.safeCurrencyCode (feeCurrencyId);
            fee = {
                'cost': feeCost,
                'currency': feeCurrencyCode,
            };
        }
        return this.safeTrade ({
            'id': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'order': orderId,
            'type': undefined,
            'side': side,
            'takerOrMaker': takerOrMaker,
            'price': price,
            'amount': amount,
            'cost': cost,
            'fee': fee,
        });
    }

    async fetchBalance (params = {}): Promise<Balances> {
        const response = await this.privateGetUsersMe(params);
        const balances = response['result']['balances'];
        const result = { 'info': response };
        for (const balance of balances) {
            const currency = this.safeCurrencyCode(balance['currency']);
            result[currency] = {
                'free': balance['available'],
                'used': balance['in_order'],
                'total': balance['total'],
            };
        }
        return this.safeBalance(result);
    }
    
    async sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'][api] + '/' + this.implodeParams(path, params);
        const query = this.omit(params, this.extractParams(path));
    
        if (api === 'public') {
            if (Object.keys(query).length) {
                url += '?' + this.urlencode(query);
            }
        } else if (api === 'private') {
            this.checkRequiredCredentials();
            const timestamp = this.nonce().toString();
            const payloadStr = 'cube.xyz';
            const payload = new TextEncoder().encode(payloadStr);
            const timestampBytes = new Uint8Array(8);
            const timestampView = new DataView(timestampBytes.buffer);
            timestampView.setBigUint64(0, BigInt(timestamp), true);
            
            const message = new Uint8Array(payload.length + timestampBytes.length);
            message.set(payload);
            message.set(timestampBytes, payload.length);
    
            const secretBytes = new TextEncoder().encode(this.secret);
            const wrappedSha256 = utils.wrapConstructor(() => sha256.create());
            const signatureBytes = hmac(wrappedSha256, secretBytes, message);
            const signature = utils.bytesToHex(signatureBytes);
    
            headers = {
                'Content-Type': 'application/json',
                'X-Cube-Api-Key': this.apiKey,
                'X-Cube-Api-Timestamp': timestamp,
                'X-Cube-Api-Signature': signature,
            };
    
            if (method === 'GET') {
                if (Object.keys(query).length) {
                    url += '?' + this.urlencode(query);
                }
            } else if (method === 'POST') {
                body = this.json(query);
            }
        }
    
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    async fetchWithdrawals (code = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const subaccountId = this.safeInteger2 (params, 'subaccountId', 'subaccount_id');
        if (subaccountId === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchWithdrawals() requires a subaccountId or subaccount_id parameter');
        }
        params = this.omit (params, ['subaccountId', 'subaccount_id']);
        const request = {
            'subaccount_id': subaccountId,
        };
        if (since !== undefined) {
            request['start_time'] = this.iso8601(since);
        }
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        const response = await this.privateGetUsersSubaccountSubaccountIdWithdrawals (this.extend (request, params));
        //
        //  {
        //    "result": {
        //      "8": {
        //        "inner": [
        //          {
        //            "address": "bcrt1qfsf0tfcw0qvtxnm8qmktwpxpt8v0hk4rawh0n7",
        //            "amount": "12000000",
        //            "approved": true,
        //            "assetId": 1,
        //            "attemptId": 112,
        //            "createdAt": "2023-07-30T14:30:00-05:00",
        //            "kytStatus": "accept",
        //            "txnHash": "faae74ae3700cdea62f51930d489a34f3bc4ee2521a017a9bad72dbd0a5156b4",
        //            "txnIndex": 1,
        //            "txnState": "confirmed",
        //            "updatedAt": "2023-07-30T14:30:00-05:00"
        //          },
        //          // ... more withdrawals
        //        ],
        //        "name": "primary"
        //      }
        //    }
        //  }
        //
        const result = this.safeValue (response, 'result', {});
        const subaccountData = this.safeValue (result, subaccountId.toString(), {});
        const withdrawals = this.safeValue (subaccountData, 'inner', []);
        const currency = (code !== undefined) ? this.currency (code) : undefined;
        return this.parseTransactions (withdrawals, currency, since, limit, { 'type': 'withdrawal' });
    }
    
    parseTransaction (transaction, currency = undefined) {
        const id = this.safeString (transaction, 'attemptId');
        const txid = this.safeString (transaction, 'txnHash');
        const timestamp = this.parse8601 (this.safeString (transaction, 'createdAt'));
        const updated = this.parse8601 (this.safeString (transaction, 'updatedAt'));
        const amount = this.safeString (transaction, 'amount');
        const address = this.safeString (transaction, 'address');
        const assetId = this.safeString (transaction, 'assetId');
        const status = this.parseTransactionStatus (this.safeString (transaction, 'txnState'));
        return {
            'info': transaction,
            'id': id,
            'txid': txid,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'network': undefined,
            'address': address,
            'addressTo': address,
            'addressFrom': undefined,
            'tag': undefined,
            'tagTo': undefined,
            'tagFrom': undefined,
            'type': 'withdrawal',
            'amount': this.parseNumber (amount),
            'currency': this.safeCurrencyCode (assetId, currency),
            'status': status,
            'updated': updated,
            'fee': undefined,
            'comment': undefined,
            'internal': false,
        };
    }
    
    parseTransactionStatus (status) {
        const statuses = {
            'confirmed': 'ok',
            'pending': 'pending',
            // Add other status mappings as needed
        };
        return this.safeString (statuses, status, 'pending');
    }

    async fetchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const subaccountId = this.safeInteger (params, 'subaccountId');
        if (subaccountId === undefined) {
            throw new ArgumentsRequired (this.id + ' fetchOrders() requires a subaccountId parameter');
        }
        params = this.omit (params, 'subaccountId');
        const request = {
            'subaccount_id': subaccountId,
        };
        const response = await this.privateGetUsersSubaccountSubaccountIdOrders (this.extend (request, params));
        //
        //  {
        //    "result": {
        //      "name": "primary",
        //      "orders": [
        //        {
        //          "cancelOnDisconnect": false,
        //          "clientOrderId": 1720791493653,
        //          "createdAt": 1720791493673997000,
        //          "filledAt": 1720933004211574000,
        //          "filledTotal": {
        //            "baseAmount": "3300000",
        //            "feeAmount": "0",
        //            "feeAssetId": 1,
        //            "filledAt": 1720933004211574000,
        //            "quoteAmount": "1800000000"
        //          },
        //          "fills": [
        //            {
        //              "baseAmount": "3300000",
        //              "baseSettled": true,
        //              "feeAmount": "0",
        //              "feeAssetId": 1,
        //              "filledAt": 1720933004211574000,
        //              "quoteAmount": "1800000000",
        //              "quoteSettled": true,
        //              "tradeId": 620011
        //            }
        //          ],
        //          "marketId": 100004,
        //          "orderId": 610001,
        //          "orderType": 0,
        //          "postOnly": false,
        //          "price": 600000,
        //          "qty": 3000,
        //          "selfTradePrevention": 0,
        //          "side": "Bid",
        //          "status": "filled",
        //          "timeInForce": 1
        //        }
        //      ]
        //    }
        //  }
        //
        const result = this.safeValue (response, 'result', {});
        const orders = this.safeValue (result, 'orders', []);
        return this.parseOrders (orders, undefined, since, limit);
    }
    
    parseOrder (order, market = undefined) {
        const id = this.safeString(order, 'orderId');
        const clientOrderId = this.safeString(order, 'clientOrderId');
        const timestamp = this.safeIntegerProduct(order, 'createdAt', 0.000001);
        const lastTradeTimestamp = this.safeIntegerProduct(order, 'filledAt', 0.000001);
        const marketId = this.safeString(order, 'marketId');
        market = this.safeMarket(marketId, market);
        const symbol = market['symbol'];
        const status = this.parseOrderStatus(this.safeString(order, 'status'));
        const side = this.parseOrderSide(this.safeString(order, 'side'));
        const orderType = this.parseOrderType(this.safeInteger(order, 'orderType'));
        const price = this.safeString(order, 'price');
        const amount = this.safeString(order, 'qty');
        const filled = this.safeString(order['filledTotal'], 'baseAmount');
        const remaining = Precise.stringSub(amount, filled);
        const cost = this.safeString(order['filledTotal'], 'quoteAmount');
        const fee = {
            'cost': this.safeString(order['filledTotal'], 'feeAmount'),
            'currency': this.safeCurrencyCode(this.safeString(order['filledTotal'], 'feeAssetId')),
        };
        const timeInForce = this.parseTimeInForce(this.safeString(order, 'timeInForce'));
        const postOnly = this.safeValue(order, 'postOnly');
        return this.safeOrder({
            'id': id,
            'clientOrderId': clientOrderId,
            'timestamp': timestamp,
            'datetime': this.iso8601(timestamp),
            'lastTradeTimestamp': lastTradeTimestamp,
            'status': status,
            'symbol': symbol,
            'type': orderType,
            'timeInForce': timeInForce,
            'postOnly': postOnly,
            'side': side,
            'price': price,
            'stopPrice': undefined,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'cost': cost,
            'average': undefined,
            'fee': fee,
            'trades': undefined,
            'info': order,
        });
    }
    
    parseOrderStatus (status) {
        const statuses = {
            'filled': 'closed',
            // Add other status mappings as needed
        };
        return this.safeString (statuses, status, status);
    }
    
    parseOrderSide (side) {
        const sides = {
            'Bid': 'buy',
            'Ask': 'sell',
        };
        return this.safeString (sides, side, side);
    }
    
    parseOrderType (orderType) {
        const types = {
            '0': 'limit',
            // Add other order type mappings as needed
        };
        return this.safeString (types, orderType, orderType);
    }
    
    parseTimeInForce (timeInForce) {
        const timeInForces = {
            '1': 'GTC',
            // Add other time in force mappings as needed
        };
        return this.safeString (timeInForces, timeInForce, timeInForce);
    }

    async withdraw (code: string, amount: number, address: string, tag?: string, params = {}) {
        await this.loadMarkets ();
        const currency = this.currency (code);
        const request = {
            'subaccountId': this.safeInteger (params, 'subaccountId'), // make sure to require this
            'assetId': currency['id'],
            'amount': this.currencyToPrecision (code, amount),
            'destination': address,
        };
        const response = await this.privatePostUsersWithdraw (this.extend (request, params));
        //
        //     {
        //         "result": {
        //             "approved": true,
        //             "status": "accept"
        //         }
        //     }
        //
        const result = this.safeValue (response, 'result', {});
        return this.parseTransaction (result, currency);
    }
    
    handleErrors (statusCode: number, statusText: string, url: string, method: string, responseHeaders: any, responseBody: string, response: any) {
        if (response === undefined) {
            return; // fallback to default error handler
        }
        if ('code' in response) {
            const code = this.safeString (response, 'code');
            const message = this.safeString (response, 'message', '');
            const feedback = this.id + ' ' + message;
            
            if (code in this.exceptions) {
                const ErrorClass = this.exceptions[code] as any as new (message: string) => Error;
                throw new ErrorClass(feedback);
            }
            
            // Check for broad exceptions
            const broadExceptions = {
                'Invalid API key': AuthenticationError,
                'Order not found': OrderNotFound,
                'Insufficient balance': InsufficientFunds,
                'Rate limit exceeded': RateLimitExceeded,
            };
            
            for (const [broadMessage, Exception] of Object.entries(broadExceptions)) {
                if (message.includes(broadMessage)) {
                    throw new Exception(feedback);
                }
            }
            
            // If no specific error is found, throw a general ExchangeError
            throw new ExchangeError(feedback);
        }
    }
}