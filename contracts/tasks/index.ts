// Paymaster tasks
import "./paymaster/deploy/deploy-paymaster-vault";
import "./paymaster/deploy/upgrade-paymaster-vault";
import "./paymaster/deploy/deploy-cross-chain-paymaster";
import "./paymaster/deploy/upgrade-cross-chain-paymaster";
import "./paymaster/deploy/deploy-mock-oracle";
import "./paymaster/post/configure-cross-chain-paymaster";
import "./paymaster/post/configure-cross-chain-paymaster-feeds";
import "./paymaster/post/configure-paymaster-vault";
import "./paymaster/post/configure-mock-price-oracle";
// Paymaster payment flow tasks
import "./paymaster/pay/deposit-token";
import "./paymaster/pay/generate-proof";
import "./paymaster/pay/relay-payment";

// General utility tasks
import "./post-blockhash";
