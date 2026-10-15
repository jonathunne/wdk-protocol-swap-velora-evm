// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { SwapProtocol } from '@tetherto/wdk-wallet/protocols'

import { JsonRpcProvider, BrowserProvider } from 'ethers'

import { constructSimpleSDK } from '@velora-dex/sdk'

/**
 * The version of the Velora API the protocol uses.
 *
 * It is pinned explicitly because the Augustus router address below is only valid for this version.
 */
const VELORA_API_VERSION = '6.2'

/**
 * The address of the Velora Augustus v6.2 router.
 *
 * Velora deploys the router at this address on every supported chain, so it is the only contract a transaction
 * built by the Velora API (pinned to v6.2 above) is allowed to call.
 *
 * @see https://developers.velora.xyz/augustus-swapper/augustus-v6.2-smart-contracts
 */
const AUGUSTUS_V6_2_ADDRESS = '0x6a000f20005980200259b80c5102003040001068'

/** The placeholder address used by Velora to represent the native coin of a chain. */
const NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/** The pattern of a well-formed calldata: a 4-byte selector followed by whole bytes. */
const CALLDATA_PATTERN = /^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{2})*$/

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapProtocolConfig} SwapProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapOptions} SwapOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwapResult} SwapResult */

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */

/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletPaymasterTokenConfig} EvmErc4337WalletPaymasterTokenConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletSponsorshipPolicyConfig} EvmErc4337WalletSponsorshipPolicyConfig */
/** @typedef {import('@tetherto/wdk-wallet-evm-erc-4337').EvmErc4337WalletNativeCoinsConfig} EvmErc4337WalletNativeCoinsConfig */

/**
 * Converts an untrusted value to a bigint.
 *
 * @param {string | number | bigint} value - The value to convert.
 * @returns {bigint | undefined} The converted value, or undefined if it cannot be represented as a bigint.
 */
function toBigIntOrUndefined (value) {
  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

export default class VeloraProtocolEvm extends SwapProtocol {
  /**
   * Creates a new read-only interface to the Velora protocol for evm blockchains.
   *
   * @overload
   * @param {IWalletAccountReadOnly} account - The wallet account to use to interact with the protocol.
   * @param {SwapProtocolConfig} [config] - The swap protocol configuration.
   */

  /**
   * Creates a new interface to the Velora protocol for evm blockchains.
   *
   * @overload
   * @param {IWalletAccount} account - The wallet account to use to interact with the protocol.
   * @param {SwapProtocolConfig} [config] - The swap protocol configuration.
   */
  constructor (account, config) {
    super(account, config)

    /** @private */
    this._veloraSdk = undefined

    if (account._config.provider) {
      const { provider } = account._config

      /** @private */
      this._provider = typeof provider === 'string'
        ? new JsonRpcProvider(provider)
        : new BrowserProvider(provider)
    }
  }

  /**
   * Swaps a pair of tokens.
   *
   * Users must first approve the necessary amount of input tokens to the Velora protocol using the account's `approve` method.
   *
   * @param {SwapOptions} options - The swap's options.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<SwapProtocolConfig, 'swapMaxFee'>} [config] - If
   *   the protocol has been initialized with an erc-4337 wallet account, it can be used to override its configuration options along with the 'swapMaxFee' option. Standard (non erc-4337)
   *   accounts silently ignore the paymaster/sponsorship config (the 'swapMaxFee' override still applies).
   * @returns {Promise<SwapResult>} The swap's result.
   * @throws {Error} If the protocol was initialized with a read-only account.
   * @throws {Error} If the account is not connected to a provider.
   * @throws {Error} If the Velora quote does not match the requested swap or carries a non-positive amount.
   * @throws {Error} If the Velora quote is below the minAmountOut option.
   * @throws {Error} If the Velora quote is not for the pinned Velora API version.
   * @throws {Error} If the transaction built by Velora does not target the Augustus router.
   * @throws {Error} If the transaction built by Velora carries a malformed calldata.
   * @throws {Error} If the transaction built by Velora carries a value that does not match the quoted input amount.
   * @throws {Error} If the quoted fee is greater than or equal to the swapMaxFee option.
   */
  async swap (options, config) {
    if (typeof this._account.sendTransaction !== 'function') {
      throw new Error("The 'swap(options)' method requires the protocol to be initialized with a non read-only account.")
    }

    if (!this._provider) {
      throw new Error('The wallet must be connected to a provider in order to perform swap operations.')
    }

    const { swapTx, tokenInAmount, tokenOutAmount } = await this._getSwapTransactions(options)

    const { swapMaxFee } = { ...this._config, ...config }

    const { fee } = await this._account.quoteSendTransaction(swapTx, config)

    if (swapMaxFee !== undefined && fee >= swapMaxFee) {
      throw new Error('Exceeded maximum fee cost for swap operation.')
    }

    const { hash } = await this._account.sendTransaction(swapTx, config)

    return { hash, fee, tokenInAmount, tokenOutAmount }
  }

  /**
   * Quotes the costs of a swap operation.
   *
   * Users must first approve the necessary amount of input tokens to the Velora protocol using the account's `approve` method.
   *
   * @param {SwapOptions} options - The swap's options.
   * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If the protocol has been initialized with
   *   an erc-4337 wallet account, it can be used to override its configuration options. Standard (non erc-4337) accounts silently ignore this config.
   * @returns {Promise<Omit<SwapResult, 'hash'>>} The swap's quotes.
   * @throws {Error} If the account is not connected to a provider.
   * @throws {Error} If the Velora quote does not match the requested swap or carries a non-positive amount.
   * @throws {Error} If the Velora quote is below the minAmountOut option.
   * @throws {Error} If the Velora quote is not for the pinned Velora API version.
   * @throws {Error} If the transaction built by Velora does not target the Augustus router.
   * @throws {Error} If the transaction built by Velora carries a malformed calldata.
   * @throws {Error} If the transaction built by Velora carries a value that does not match the quoted input amount.
   */
  async quoteSwap (options, config) {
    if (!this._provider) {
      throw new Error('The wallet must be connected to a provider in order to quote swap operations.')
    }

    const { swapTx, tokenInAmount, tokenOutAmount } = await this._getSwapTransactions(options)

    const { fee } = await this._account.quoteSendTransaction(swapTx, config)

    return { fee, tokenInAmount, tokenOutAmount }
  }

  /** @private */
  async _getVeloraSdk () {
    if (!this._veloraSdk) {
      const network = await this._provider.getNetwork()

      this._veloraSdk = constructSimpleSDK({
        fetch,
        chainId: Number(network.chainId),
        version: VELORA_API_VERSION
      })
    }

    return this._veloraSdk
  }

  /** @private */
  async _getSwapTransactions ({ tokenIn, tokenOut, tokenInAmount, tokenOutAmount, minAmountOut, to }) {
    const veloraSdk = await this._getVeloraSdk()

    const { side, amount } = tokenInAmount
      ? { side: 'SELL', amount: tokenInAmount }
      : { side: 'BUY', amount: tokenOutAmount }

    const priceRoute = await veloraSdk.swap.getRate({
      srcToken: tokenIn,
      destToken: tokenOut,
      amount: amount.toString(),
      side
    })

    const srcAmount = toBigIntOrUndefined(priceRoute.srcAmount)
    const destAmount = toBigIntOrUndefined(priceRoute.destAmount)
    const exactAmount = side === 'SELL' ? srcAmount : destAmount
    if (typeof priceRoute.srcToken !== 'string' || priceRoute.srcToken.toLowerCase() !== tokenIn.toLowerCase() ||
        typeof priceRoute.destToken !== 'string' || priceRoute.destToken.toLowerCase() !== tokenOut.toLowerCase() ||
        srcAmount === undefined || destAmount === undefined || srcAmount <= 0n || destAmount <= 0n ||
        exactAmount !== BigInt(amount)) {
      throw new Error('Velora quote does not match the requested swap.')
    }

    if (minAmountOut !== undefined && destAmount < BigInt(minAmountOut)) {
      throw new Error('Velora quote is below the minimum output amount.')
    }

    const address = await this._account.getAddress()

    const builtTx = await veloraSdk.swap.buildTx({
      partner: 'wdk',
      srcToken: priceRoute.srcToken,
      destToken: priceRoute.destToken,
      srcAmount: priceRoute.srcAmount,
      destAmount: side === 'SELL' && minAmountOut !== undefined
        ? minAmountOut.toString()
        : priceRoute.destAmount,
      userAddress: address,
      receiver: to,
      priceRoute
    }, {
      ignoreChecks: true
    })

    const swapTx = this._getVerifiedSwapTransaction(builtTx, priceRoute, srcAmount)

    return {
      swapTx,
      tokenInAmount: srcAmount,
      tokenOutAmount: destAmount
    }
  }

  /** @private */
  _getVerifiedSwapTransaction (builtTx, priceRoute, srcAmount) {
    const { to, data, value } = builtTx

    if (priceRoute.version !== VELORA_API_VERSION) {
      throw new Error(`Velora quote is not for API version ${VELORA_API_VERSION}.`)
    }

    if (typeof to !== 'string' || to.toLowerCase() !== AUGUSTUS_V6_2_ADDRESS) {
      throw new Error('Velora transaction does not target the Augustus router.')
    }

    if (typeof data !== 'string' || !CALLDATA_PATTERN.test(data)) {
      throw new Error('Velora transaction data is malformed.')
    }

    const expectedValue = priceRoute.srcToken.toLowerCase() === NATIVE_TOKEN_ADDRESS ? srcAmount : 0n

    if (toBigIntOrUndefined(value ?? 0) !== expectedValue) {
      throw new Error('Velora transaction value does not match the requested swap.')
    }

    return { to: AUGUSTUS_V6_2_ADDRESS, data, value: expectedValue }
  }
}
