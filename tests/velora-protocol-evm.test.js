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
const AUGUSTUS = '0x6A000F20005980200259B80c5102003040001068'
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const ATTACKER = '0xf90e98F3D8Dce44632E5020ABF2E122E0f99DFAb'

const SWAP_DATA = '0xe3ead59e' + '0'.repeat(64)

const constructSimpleSDKMock = jest.fn()

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
  constructSimpleSDK: constructSimpleSDKMock.mockReturnValue({
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
    destAmount: '100000',
    contractAddress: AUGUSTUS,
    version: '6.2'
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
    from: USER_ADDRESS,
    to: AUGUSTUS,
    value: '0',
    data: SWAP_DATA,
    gasPrice: '1000000000',
    gas: 210000,
    chainId: 1
  }

  const EXPECTED_SWAP_TRANSACTION = {
    to: AUGUSTUS.toLowerCase(),
    data: SWAP_DATA,
    value: 0n
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

    test('pins the Velora SDK to API version 6.2', async () => {
      await protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n })

      expect(constructSimpleSDKMock).toHaveBeenCalledWith({ fetch: expect.any(Function), chainId: 1, version: '6.2' })
    })

    test('passes only the router, calldata and value of the built transaction to the account', async () => {
      await protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n })

      expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)
    })

    test.each([AUGUSTUS, AUGUSTUS.toLowerCase(), AUGUSTUS.toUpperCase().replace('0X', '0x')])('normalizes the router address %s', async (to) => {
      buildTxMock.mockResolvedValue({ ...DUMMY_SWAP_TRANSACTION, to })

      await protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n })

      expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)
    })

    test.each([
      ['two words', '0xe3ead59e' + '0'.repeat(128)],
      ['uppercase hex', '0xE3EAD59E' + 'A'.repeat(64)],
      ['a non word-aligned length', '0xe3ead59e' + 'ab']
    ])('accepts a calldata with %s', async (_, data) => {
      buildTxMock.mockResolvedValue({ ...DUMMY_SWAP_TRANSACTION, data })

      await protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n })

      expect(account.quoteSendTransaction).toHaveBeenCalledWith({ ...EXPECTED_SWAP_TRANSACTION, data }, undefined)
    })

    test.each([null, undefined, 'not-an-object'])('rejects a built transaction of %s', async (builtTx) => {
      buildTxMock.mockResolvedValue(builtTx)

      await expect(protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n }))
        .rejects.toThrow('Velora transaction does not target the Augustus router.')

      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each([
      ['a malformed source amount', { srcAmount: 'abc' }],
      ['a malformed destination amount', { destAmount: '1.5' }],
      ['a non-string source token', { srcToken: 12345 }],
      ['a non-string destination token', { destToken: undefined }]
    ])('rejects a quote with %s before building or sending', async (_, route) => {
      getRateMock.mockResolvedValue({ ...DUMMY_PRICE_ROUTE, ...route })

      await expect(protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenOutAmount: 100_000n }))
        .rejects.toThrow('Velora quote does not match the requested swap.')

      expect(buildTxMock).not.toHaveBeenCalled()
      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
    })

    test.each([
      ['another contract', ATTACKER],
      ['the user address', USER_ADDRESS],
      ['an empty address', ''],
      ['a missing address', undefined],
      ['a non-string address', 12345]
    ])('rejects a built transaction that targets %s', async (_, to) => {
      buildTxMock.mockResolvedValue({ ...DUMMY_SWAP_TRANSACTION, to })

      await expect(protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n }))
        .rejects.toThrow('Velora transaction does not target the Augustus router.')

      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each(['5', undefined, 6.2, '6.2.0'])('rejects a price route whose API version is %s', async (version) => {
      getRateMock.mockResolvedValue({ ...DUMMY_PRICE_ROUTE, version })

      await expect(protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n }))
        .rejects.toThrow('Velora transaction does not target the Augustus router.')

      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each([
      ['a non-hex string', 'dummy-swap-method-data'],
      ['an empty calldata', '0x'],
      ['a truncated selector', '0xe3ea'],
      ['an odd number of hex digits', '0xe3ead59e' + '0'.repeat(63)],
      ['a 0X prefix', '0Xe3ead59e' + '0'.repeat(64)],
      ['a missing calldata', undefined],
      ['a non-string calldata', 12345]
    ])('rejects a built transaction with %s', async (_, data) => {
      buildTxMock.mockResolvedValue({ ...DUMMY_SWAP_TRANSACTION, data })

      await expect(protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n }))
        .rejects.toThrow('Velora transaction data is malformed.')

      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each(['1', '1000000000000000000', 1, 1n, '0x1', 'abc'])('rejects a value of %s on a token swap', async (value) => {
      buildTxMock.mockResolvedValue({ ...DUMMY_SWAP_TRANSACTION, value })

      await expect(protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n }))
        .rejects.toThrow('Velora transaction value does not match the requested swap.')

      expect(account.quoteSendTransaction).not.toHaveBeenCalled()
      expect(account.sendTransaction).not.toHaveBeenCalled()
    })

    test.each(['0', 0, 0n, '0x0', undefined, null])('accepts a value of %s on a token swap', async (value) => {
      buildTxMock.mockResolvedValue({ ...DUMMY_SWAP_TRANSACTION, value })

      await protocol[method]({ tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, tokenInAmount: 100n })

      expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)
    })

    describe('with the native coin as input token', () => {
      beforeEach(() => {
        getRateMock.mockResolvedValue({ ...DUMMY_PRICE_ROUTE, srcToken: NATIVE_TOKEN })
      })

      test.each(['100', 100, 100n, '0x64'])('accepts a value of %s equal to the quoted input amount', async (value) => {
        buildTxMock.mockResolvedValue({ ...DUMMY_SWAP_TRANSACTION, value })

        await protocol[method]({ tokenIn: NATIVE_TOKEN, tokenOut: TOKEN_OUT, tokenInAmount: 100n })

        expect(account.quoteSendTransaction).toHaveBeenCalledWith({
          ...EXPECTED_SWAP_TRANSACTION,
          value: 100n
        }, undefined)
      })

      test.each(['0', '99', '101', '1000000000000000000', undefined])('rejects a value of %s that differs from the quoted input amount', async (value) => {
        buildTxMock.mockResolvedValue({ ...DUMMY_SWAP_TRANSACTION, value })

        await expect(protocol[method]({ tokenIn: NATIVE_TOKEN, tokenOut: TOKEN_OUT, tokenInAmount: 100n }))
          .rejects.toThrow('Velora transaction value does not match the requested swap.')

        expect(account.quoteSendTransaction).not.toHaveBeenCalled()
        expect(account.sendTransaction).not.toHaveBeenCalled()
      })
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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

        expect(account.sendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

        expect(account.sendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

        expect(account.sendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

        expect(account.sendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, CONFIG)

        expect(account.sendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, CONFIG)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, undefined)

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

        expect(account.quoteSendTransaction).toHaveBeenCalledWith(EXPECTED_SWAP_TRANSACTION, CONFIG)

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
