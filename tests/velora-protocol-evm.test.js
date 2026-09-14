import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import * as ethers from 'ethers'

import * as veloraDexSdk from '@velora-dex/sdk'

import { WalletAccountEvm, WalletAccountReadOnlyEvm } from '@tetherto/wdk-wallet-evm'

import { WalletAccountEvmErc4337, WalletAccountReadOnlyEvmErc4337 } from '@tetherto/wdk-wallet-evm-erc-4337'

const { SwapSide } = veloraDexSdk

const SEED = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const USER_ADDRESS = '0xa460AEbce0d3A4BecAd8ccf9D6D4861296c503Bd'

const TOKEN_IN = '0x9e6b38E072f624fdC4Fbaf7bB12a7D9e657435ce'
const TOKEN_OUT = '0x73091d62F1F11DCb172530126E9630e327770e05'
const VELORA = '0xf90e98F3D8Dce44632E5020ABF2E122E0f99DFAb'

const getRateMock = jest.fn()

const buildTxMock = jest.fn()

jest.unstable_mockModule('ethers', () => ({
  ...ethers,
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getNetwork: jest.fn().mockResolvedValue({ chainId: 1n })
  }))
}))

jest.unstable_mockModule('@velora-dex/sdk', () => ({
  ...veloraDexSdk,
  constructSimpleSDK: jest.fn().mockReturnValue({
    chainId: 1,
    swap: {
      getRate: getRateMock,
      buildTx: buildTxMock
    }
  })
}))

const { default: VeloraProtocolEvm } = await import('../index.js')

describe('VeloraSwapProtocolEvm', () => {
  const DUMMY_PRICE_ROUTE = {
    srcToken: TOKEN_IN,
    destToken: TOKEN_OUT,
    srcAmount: '100',
    destAmount: '100000'
  }

  const DUMMY_BUILD_TX_INPUT = {
    partner: 'wdk',
    srcToken: DUMMY_PRICE_ROUTE.srcToken,
    destToken: DUMMY_PRICE_ROUTE.destToken,
    srcAmount: DUMMY_PRICE_ROUTE.srcAmount,
    destAmount: DUMMY_PRICE_ROUTE.destAmount,
    userAddress: USER_ADDRESS,
    receiver: undefined,
    priceRoute: DUMMY_PRICE_ROUTE
  }

  const DUMMY_SWAP_TRANSACTION = {
    to: VELORA,
    value: 0,
    data: 'dummy-swap-method-data'
  }

  let account,
      protocol

  describe.each(['swap', 'quoteSwap'])('%s quote validation', (method) => {
    beforeEach(() => {
      getRateMock.mockReset().mockResolvedValue(DUMMY_PRICE_ROUTE)
      buildTxMock.mockReset().mockResolvedValue(DUMMY_SWAP_TRANSACTION)
      account = new WalletAccountEvm(SEED, "0'/0/0", {
        provider: 'https://mock-rpc-url.com'
      })
      account.getAddress = jest.fn().mockResolvedValue(USER_ADDRESS)
      account.quoteSendTransaction = jest.fn().mockResolvedValue({ fee: 12_345n })
      account.sendTransaction = jest.fn().mockResolvedValue({ hash: 'dummy-swap-hash' })
      protocol = new VeloraProtocolEvm(account)
    })

    test.each([
      ['sell input token', { tokenInAmount: 100n }, { srcToken: TOKEN_OUT }],
      ['sell output token', { tokenInAmount: 100n }, { destToken: TOKEN_IN }],
      ['buy input token', { tokenOutAmount: 100_000n }, { srcToken: TOKEN_OUT }],
      ['buy output token', { tokenOutAmount: 100_000n }, { destToken: TOKEN_IN }],
      ['sell exact amount', { tokenInAmount: 100n }, { srcAmount: '101' }],
      ['buy exact amount', { tokenOutAmount: 100_000n }, { destAmount: '99999' }]
    ])('rejects a quote with a mismatched %s before building or sending', async (_, amounts, route) => {
      getRateMock.mockResolvedValue({ ...DUMMY_PRICE_ROUTE, ...route })

      await expect(protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, ...amounts }))
        .rejects.toThrow('Velora quote does not match the requested swap.')

      expect(buildTxMock).not.toHaveBeenCalled()
      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each([
      ['sell', { tokenInAmount: 100n }],
      ['buy', { tokenOutAmount: 100_000n }]
    ])('rejects a %s quote below minAmountOut before building or sending', async (_, amounts) => {
      await expect(protocol[method]({
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        ...amounts,
        minAmountOut: 100_001n
      })).rejects.toThrow('Velora quote is below the minimum output amount.')

      expect(buildTxMock).not.toHaveBeenCalled()
      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each([0n, 90_000, 100_000n])('uses the explicit sell floor %s in buildTx', async (minAmountOut) => {
      const result = await protocol[method]({
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        tokenInAmount: 100n,
        minAmountOut
      })

      expect(buildTxMock).toHaveBeenCalledWith({
        ...DUMMY_BUILD_TX_INPUT,
        destAmount: minAmountOut.toString()
      }, { ignoreChecks: true })
      expect(result.tokenOutAmount).toBe(100_000n)
    })

    test('keeps the exact buy output when minAmountOut is lower', async () => {
      await protocol[method]({
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        tokenOutAmount: 100_000n,
        minAmountOut: 90_000n
      })

      expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })
    })

    test('accepts case-insensitive token addresses and exact bigint amounts', async () => {
      const amount = 9_007_199_254_740_993n
      const priceRoute = {
        ...DUMMY_PRICE_ROUTE,
        srcToken: TOKEN_IN.toLowerCase(),
        destToken: TOKEN_OUT.toLowerCase(),
        srcAmount: amount.toString()
      }
      getRateMock.mockResolvedValue(priceRoute)

      const result = await protocol[method]({
        tokenIn: TOKEN_IN,
        tokenOut: TOKEN_OUT,
        tokenInAmount: amount
      })

      expect(buildTxMock).toHaveBeenCalledWith({
        ...DUMMY_BUILD_TX_INPUT,
        srcToken: priceRoute.srcToken,
        destToken: priceRoute.destToken,
        srcAmount: amount.toString(),
        priceRoute
      }, { ignoreChecks: true })
      expect(result.tokenInAmount).toBe(amount)
    })
  })

  describe('with WalletAccountEvm', () => {
    beforeEach(() => {
      account = new WalletAccountEvm(SEED, "0'/0/0", {
        provider: 'https://mock-rpc-url.com'
      })

      account.getAddress = jest.fn().mockResolvedValue(USER_ADDRESS)

      protocol = new VeloraProtocolEvm(account)
    })

    describe('swap', () => {
      beforeEach(() => {
        getRateMock.mockResolvedValue(DUMMY_PRICE_ROUTE)

        buildTxMock.mockResolvedValue(DUMMY_SWAP_TRANSACTION)

        account.quoteSendTransaction = jest.fn()
          .mockResolvedValueOnce({ fee: 12_345n })

        account.sendTransaction = jest.fn()
          .mockResolvedValueOnce({ hash: 'dummy-swap-hash', fee: 12_345n })
      })

      test('should successfully perform a swap operation (buy)', async () => {
        const result = await protocol.swap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenOutAmount: 100_000
        })

        expect(getRateMock).toHaveBeenCalledWith({
          srcToken: TOKEN_IN,
          destToken: TOKEN_OUT,
          amount: '100000',
          side: SwapSide.BUY
        })

        expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(account.sendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(result).toEqual({
          hash: 'dummy-swap-hash',
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should successfully perform a swap operation (sell)', async () => {
        const result = await protocol.swap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenInAmount: 100
        })

        expect(getRateMock).toHaveBeenCalledWith({
          srcToken: TOKEN_IN,
          destToken: TOKEN_OUT,
          amount: '100',
          side: SwapSide.SELL
        })

        expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(account.sendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(result).toEqual({
          hash: 'dummy-swap-hash',
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should throw if the swap fee exceeds the swap max fee configuration', async () => {
        const OPTIONS = {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenOutAmount: 100_000
        }

        const protocol = new VeloraProtocolEvm(account, {
          swapMaxFee: 0
        })

        await expect(protocol.swap(OPTIONS))
          .rejects.toThrow('Exceeded maximum fee cost for swap operation.')
      })

      test('should throw if the account is read-only', async () => {
        const account = new WalletAccountReadOnlyEvm(USER_ADDRESS, {
          provider: 'https://mock-rpc-url.com'
        })

        const protocol = new VeloraProtocolEvm(account)

        await expect(protocol.swap({ }))
          .rejects.toThrow("The 'swap(options)' method requires the protocol to be initialized with a non read-only account.")
      })

      test('should throw if the account is not connected to a provider', async () => {
        const account = new WalletAccountEvm(SEED, "0'/0/0")

        const protocol = new VeloraProtocolEvm(account)

        await expect(protocol.swap({ }))
          .rejects.toThrow('The wallet must be connected to a provider in order to perform swap operations.')
      })
    })

    describe('quoteSwap', () => {
      beforeEach(() => {
        getRateMock.mockResolvedValue(DUMMY_PRICE_ROUTE)

        buildTxMock.mockResolvedValue(DUMMY_SWAP_TRANSACTION)

        account.quoteSendTransaction = jest.fn()
          .mockResolvedValueOnce({ fee: 12_345n })
      })

      test('should successfully quote a swap operation (buy)', async () => {
        const result = await protocol.quoteSwap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenOutAmount: 100_000
        })

        expect(getRateMock).toHaveBeenCalledWith({
          srcToken: TOKEN_IN,
          destToken: TOKEN_OUT,
          amount: '100000',
          side: SwapSide.BUY
        })

        expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(result).toEqual({
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should successfully quote a swap operation (sell)', async () => {
        const result = await protocol.quoteSwap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenInAmount: 100
        })

        expect(getRateMock).toHaveBeenCalledWith({
          srcToken: TOKEN_IN,
          destToken: TOKEN_OUT,
          amount: '100',
          side: SwapSide.SELL
        })

        expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(result).toEqual({
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should throw if the account is not connected to a provider', async () => {
        const account = new WalletAccountEvm(SEED, "0'/0/0")

        const protocol = new VeloraProtocolEvm(account)

        await expect(protocol.quoteSwap({ }))
          .rejects.toThrow('The wallet must be connected to a provider in order to quote swap operations.')
      })
    })
  })

  describe('with WalletAccountEvmErc4337', () => {
    beforeEach(() => {
      account = new WalletAccountEvmErc4337(SEED, "0'/0/0", {
        chainId: 1,
        provider: 'https://mock-rpc-url.com',
        safeModulesVersion: '0.3.0'
      })

      account.getAddress = jest.fn().mockResolvedValue(USER_ADDRESS)

      protocol = new VeloraProtocolEvm(account)
    })

    describe('swap', () => {
      beforeEach(() => {
        getRateMock.mockResolvedValue(DUMMY_PRICE_ROUTE)

        buildTxMock.mockResolvedValue(DUMMY_SWAP_TRANSACTION)

        account.quoteSendTransaction = jest.fn()
          .mockResolvedValueOnce({ fee: 12_345n })

        account.sendTransaction = jest.fn()
          .mockResolvedValueOnce({ hash: 'dummy-user-operation-hash', fee: 12_345n })
      })

      test('should successfully perform a swap operation (buy)', async () => {
        const result = await protocol.swap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenOutAmount: 100_000
        })

        expect(getRateMock).toHaveBeenCalledWith({
          srcToken: TOKEN_IN,
          destToken: TOKEN_OUT,
          amount: '100000',
          side: SwapSide.BUY
        })

        expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(account.sendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(result).toEqual({
          hash: 'dummy-user-operation-hash',
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should successfully perform a swap operation (sell)', async () => {
        const result = await protocol.swap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenInAmount: 100
        })

        expect(getRateMock).toHaveBeenCalledWith({
          srcToken: TOKEN_IN,
          destToken: TOKEN_OUT,
          amount: '100',
          side: SwapSide.SELL
        })

        expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(account.sendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(result).toEqual({
          hash: 'dummy-user-operation-hash',
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should forward a config override to quote and send', async () => {
        const CONFIG = { isSponsored: true }

        const result = await protocol.swap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenOutAmount: 100_000
        }, CONFIG)

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, CONFIG)

        expect(account.sendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, CONFIG)

        expect(result).toEqual({
          hash: 'dummy-user-operation-hash',
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should throw if the swap fee exceeds the swap max fee configuration', async () => {
        const OPTIONS = {
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenOutAmount: 100_000
        }

        const protocol = new VeloraProtocolEvm(account, {
          swapMaxFee: 0
        })

        await expect(protocol.swap(OPTIONS))
          .rejects.toThrow('Exceeded maximum fee cost for swap operation.')
      })

      test('should throw if the account is read-only', async () => {
        const account = new WalletAccountReadOnlyEvmErc4337(USER_ADDRESS, {
          chainId: 1,
          provider: 'https://mock-rpc-url.com',
          safeModulesVersion: '0.3.0'
        })

        const protocol = new VeloraProtocolEvm(account)

        await expect(protocol.swap({ }))
          .rejects.toThrow("The 'swap(options)' method requires the protocol to be initialized with a non read-only account.")
      })

      test('should throw if the account is not connected to a provider', async () => {
        const account = new WalletAccountEvmErc4337(SEED, "0'/0/0", {
          chainId: 1,
          safeModulesVersion: '0.3.0'
        })

        const protocol = new VeloraProtocolEvm(account)

        await expect(protocol.swap({ }))
          .rejects.toThrow('The wallet must be connected to a provider in order to perform swap operations.')
      })
    })

    describe('quoteSwap', () => {
      beforeEach(() => {
        getRateMock.mockResolvedValue(DUMMY_PRICE_ROUTE)

        buildTxMock.mockResolvedValue(DUMMY_SWAP_TRANSACTION)

        account.quoteSendTransaction = jest.fn()
          .mockResolvedValueOnce({ fee: 12_345n })
      })

      test('should successfully quote a swap operation (buy)', async () => {
        const result = await protocol.quoteSwap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenOutAmount: 100_000
        })

        expect(getRateMock).toHaveBeenCalledWith({
          srcToken: TOKEN_IN,
          destToken: TOKEN_OUT,
          amount: '100000',
          side: SwapSide.BUY
        })

        expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(result).toEqual({
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should successfully quote a swap operation (sell)', async () => {
        const result = await protocol.quoteSwap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenInAmount: 100
        })

        expect(getRateMock).toHaveBeenCalledWith({
          srcToken: TOKEN_IN,
          destToken: TOKEN_OUT,
          amount: '100',
          side: SwapSide.SELL
        })

        expect(buildTxMock).toHaveBeenCalledWith(DUMMY_BUILD_TX_INPUT, { ignoreChecks: true })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, undefined)

        expect(result).toEqual({
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should forward a config override to quoteSwap', async () => {
        const CONFIG = { isSponsored: true }

        const result = await protocol.quoteSwap({
          tokenIn: TOKEN_IN,
          tokenOut: TOKEN_OUT,
          tokenOutAmount: 100_000
        }, CONFIG)

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(DUMMY_SWAP_TRANSACTION, CONFIG)

        expect(result).toEqual({
          fee: 12_345n,
          tokenInAmount: 100n,
          tokenOutAmount: 100_000n
        })
      })

      test('should throw if the account is not connected to a provider', async () => {
        const account = new WalletAccountEvmErc4337(SEED, "0'/0/0", {
          chainId: 1,
          safeModulesVersion: '0.3.0'
        })

        const protocol = new VeloraProtocolEvm(account)

        await expect(protocol.quoteSwap({ }))
          .rejects.toThrow('The wallet must be connected to a provider in order to quote swap operations.')
      })
    })
  })
})
