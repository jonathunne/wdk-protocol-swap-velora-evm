export default class VeloraProtocolEvm extends SwapProtocol {
    /**
     * Creates a new read-only interface to the Velora protocol for evm blockchains.
     *
     * @overload
     * @param {IWalletAccountReadOnly} account - The wallet account to use to interact with the protocol.
     * @param {SwapProtocolConfig} [config] - The swap protocol configuration.
     */
    constructor(account: IWalletAccountReadOnly, config?: SwapProtocolConfig);
    /**
     * Creates a new interface to the Velora protocol for evm blockchains.
     *
     * @overload
     * @param {IWalletAccount} account - The wallet account to use to interact with the protocol.
     * @param {SwapProtocolConfig} [config] - The swap protocol configuration.
     */
    constructor(account: IWalletAccount, config?: SwapProtocolConfig);
    /** @private */
    private _veloraSdk;
    /** @private */
    private _provider;
    /**
     * Swaps a pair of tokens.
     *
     * Users must first approve the necessary amount of input tokens to the Velora protocol using the account's `approve` method.
     *
     * @param {SwapOptions} options - The swap's options.
     * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<SwapProtocolConfig, 'swapMaxFee'>} [config] - If
     *   the protocol has been initialized with an erc-4337 wallet account, it can be used to override its configuration options along with the 'swapMaxFee' option. Standard (non erc-4337) accounts silently ignore the paymaster/sponsorship config (the 'swapMaxFee' override still applies).
     * @returns {Promise<SwapResult>} The swap's result.
     */
    swap(options: SwapOptions, config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig> & Pick<SwapProtocolConfig, "swapMaxFee">): Promise<SwapResult>;
    /**
     * Quotes the costs of a swap operation.
     *
     * Users must first approve the necessary amount of input tokens to the Velora protocol using the account's `approve` method.
     *
     * @param {SwapOptions} options - The swap's options.
     * @param {Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>} [config] - If the protocol has been initialized with
     *   an erc-4337 wallet account, it can be used to override its configuration options. Standard (non erc-4337) accounts silently ignore this config.
     * @returns {Promise<Omit<SwapResult, 'hash'>>} The swap's quotes.
     */
    quoteSwap(options: SwapOptions, config?: Partial<EvmErc4337WalletPaymasterTokenConfig | EvmErc4337WalletSponsorshipPolicyConfig | EvmErc4337WalletNativeCoinsConfig>): Promise<Omit<SwapResult, "hash">>;
    /** @private */
    private _getVeloraSdk;
    /** @private */
    private _getSwapTransactions;
}
export type SwapProtocolConfig = import("@tetherto/wdk-wallet/protocols").SwapProtocolConfig;
export type SwapOptions = import("@tetherto/wdk-wallet/protocols").SwapOptions;
export type SwapResult = import("@tetherto/wdk-wallet/protocols").SwapResult;
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type EvmErc4337WalletPaymasterTokenConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletPaymasterTokenConfig;
export type EvmErc4337WalletSponsorshipPolicyConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletSponsorshipPolicyConfig;
export type EvmErc4337WalletNativeCoinsConfig = import("@tetherto/wdk-wallet-evm-erc-4337").EvmErc4337WalletNativeCoinsConfig;
import { SwapProtocol } from '@tetherto/wdk-wallet/protocols';
