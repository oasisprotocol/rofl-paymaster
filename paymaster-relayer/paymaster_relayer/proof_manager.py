"""
Proof generation manager for ROFL Relayer.

This module handles the generation and submission of cryptographic proofs
for cross-chain message verification using the Hashi protocol format.
"""

import asyncio
import logging
from typing import TYPE_CHECKING, Any

import rlp
from eth_typing import HexStr
from trie import HexaryTrie
from web3 import Web3
from web3.types import TxParams, TxReceipt, Wei

from .models import PaymentEvent
from .utils.blockchain_encoder import BlockchainEncoder

if TYPE_CHECKING:
    from .utils.contract_utility import ContractUtility
    from .utils.multi_rpc_provider import MultiRpcProvider
    from .utils.rofl_utility import ROFLUtility

logger = logging.getLogger(__name__)

# FuturePriceTimestamp error from CrossChainPaymaster.sol
FUTURE_PRICE_TIMESTAMP_ERROR_B64 = "4B8j6Q"
FUTURE_PRICE_RETRY_DELAY = 6  # seconds to wait before retry
FUTURE_PRICE_MAX_RETRIES = 3  # maximum retry attempts

# DuplicatePayment error from CrossChainPaymaster.sol
DUPLICATE_PAYMENT_ERROR_B64 = "3zO4b"


class ProofManager:
    """Handles proof generation and submission for cross-chain messages."""

    def __init__(
        self,
        source_provider: "MultiRpcProvider",
        contract_util: "ContractUtility",
        rofl_util: "ROFLUtility | None" = None,
    ):
        """
        Initialize the ProofManager.

        Args:
            source_provider: MultiRpcProvider for source chain with failover
            contract_util: Utility for contract interactions
            rofl_util: ROFL utility for transaction submission (optional)
        """
        self.source_provider = source_provider
        self.contract_util = contract_util
        self.rofl_util = rofl_util

    def _get_transaction_local_index(self, payment_event: PaymentEvent) -> int:
        """
        Find the transaction-local index for a specific PaymentInitiated event.

        This matches the event by signature and address rather than global log index.
        For PaymentInitiated events:
        - Event signature: PaymentInitiated(address,address,address,uint256,bytes32)
        - Topics[0]: keccak256("PaymentInitiated(address,address,address,uint256,bytes32)")
        - Topics[1]: indexed payer
        - Topics[2]: indexed recipient
        - Topics[3]: indexed token

        Args:
            payment_event: The PaymentEvent object with tx_hash and block_number

        Returns:
            Transaction-local index (position within transaction's logs)
        """
        receipt = self.source_provider.execute_with_failover(
            lambda w3: w3.eth.get_transaction_receipt(HexStr(payment_event.tx_hash))
        )
        if not receipt or "logs" not in receipt:
            logger.warning(f"No logs found in transaction {payment_event.tx_hash}")
            return 0

        # Calculate PaymentInitiated event signature hash
        payment_topic = Web3.keccak(
            text="PaymentInitiated(address,address,address,uint256,bytes32)"
        )

        # Find matching PaymentInitiated event in transaction logs
        for i, log in enumerate(receipt["logs"]):
            topics = log.get("topics", [])
            if len(topics) >= 1 and topics[0] == payment_topic:
                logger.info(f"Found PaymentInitiated at transaction-local index {i}")
                return i

        # If not found (shouldn't happen), default to 0
        logger.warning(
            "PaymentInitiated not found in transaction logs, defaulting to index 0"
        )
        return 0

    async def generate_proof(self, payment_event: PaymentEvent) -> list[Any]:
        """
        Generate Hashi-format proof for a PaymentInitiated event.

        Uses eth_getBlockReceipts for efficient batch receipt fetching when available.

        Args:
            payment_event: The PaymentEvent object containing all event data

        Returns:
            8-element array matching TypeScript format for Hashi proof

        Raises:
            ValueError: If receipt or block not found, or proof generation fails
        """
        # Calculate transaction-local log index from event content
        log_index = await asyncio.to_thread(
            self._get_transaction_local_index, payment_event
        )
        logger.info(
            f"Generating proof for tx {payment_event.tx_hash}, transaction-local log index {log_index}"
        )

        # 1. Fetch receipt and block
        receipt = await asyncio.to_thread(
            self.source_provider.execute_with_failover,
            lambda w3: w3.eth.get_transaction_receipt(HexStr(payment_event.tx_hash)),
        )
        if not receipt:
            raise ValueError(
                f"Transaction receipt not found for {payment_event.tx_hash}"
            )

        block_number = receipt["blockNumber"]
        block = await asyncio.to_thread(
            self.source_provider.execute_with_failover,
            lambda w3: w3.eth.get_block(block_number, full_transactions=True),
        )
        if not block:
            raise ValueError(f"Block not found for block number {block_number}")

        logger.info(
            f"Processing block {block_number}, tx index {receipt['transactionIndex']}"
        )

        # 2. Get all receipts in block
        receipts = await asyncio.to_thread(self._get_block_receipts, block_number)

        logger.info(f"Fetched {len(receipts)} receipts from block")

        # 3. RLP encode all receipts and build trie
        trie = HexaryTrie({})

        for _idx, rec in enumerate(receipts):
            # Encode transaction index as trie key
            tx_index = rec["transactionIndex"]
            key = BlockchainEncoder.encode_transaction_index(tx_index)

            # Encode the receipt
            encoded_receipt = BlockchainEncoder.encode_receipt(rec)

            # Put in trie
            trie[key] = encoded_receipt

        # 4. Verify trie root matches block's receiptsRoot
        calculated_root = Web3.to_hex(trie.root_hash)
        block_receipts_root = Web3.to_hex(block["receiptsRoot"])

        if calculated_root != block_receipts_root:
            raise ValueError(
                f"Trie root mismatch! Calculated: {calculated_root}, Block: {block_receipts_root}"
            )

        # 5. Generate proof for target receipt
        tx_index = receipt["transactionIndex"]
        receipt_key = BlockchainEncoder.encode_transaction_index(tx_index)
        proof_nodes = trie.get_proof(receipt_key)

        merkle_proof = [Web3.to_hex(rlp.encode(node)) for node in proof_nodes]

        # 6. Encode block header
        encoded_block_header = BlockchainEncoder.encode_block_header(block)

        chain_id = await asyncio.to_thread(
            self.source_provider.execute_with_failover,
            lambda w3: int(w3.eth.chain_id),
        )

        # 7. Create proof structure for Hashi
        proof = [
            chain_id,  # chainId
            block_number,  # blockNumber
            encoded_block_header,  # encodedBlockHeader
            0,  # ancestralBlockNumber (not used in MVP)
            [],  # ancestralBlockHeaders (not used in MVP)
            merkle_proof,  # merkleProof
            Web3.to_hex(receipt_key),  # transactionIndex (RLP encoded)
            log_index,  # logIndex
        ]

        logger.info(
            f"Proof generated successfully with {len(merkle_proof)} merkle nodes"
        )
        return proof

    async def submit_proof(
        self, proof: list[Any], paymaster_address: str
    ) -> str | None:
        """
        Submit proof to CrossChainPaymaster contract.

        Includes retry logic for FuturePriceTimestamp errors, which occur when
        the price oracle's timestamp is slightly ahead of the block timestamp.

        Args:
            proof: The generated proof array
            paymaster_address: Address of the CrossChainPaymaster contract

        Returns:
            Transaction hash of the submission, or None if all retries failed
        """
        logger.info(f"Submitting proof to CrossChainPaymaster at {paymaster_address}")

        abi = self.contract_util.get_contract_abi("CrossChainPaymaster")
        contract = self.contract_util.w3.eth.contract(
            address=Web3.to_checksum_address(paymaster_address), abi=abi
        )

        receipt_proof_struct = {
            "chainId": proof[0],
            "blockNumber": proof[1],
            "blockHeader": proof[2],
            "ancestralBlockNumber": proof[3],
            "ancestralBlockHeaders": proof[4],
            "receiptProof": proof[5],  # This is the merkleProof array
            "transactionIndex": proof[6],
            "logIndex": proof[7],
        }

        logger.info(
            f"Proof formatted for ReceiptProof struct with {len(proof[5])} merkle proof elements"
        )

        if self.rofl_util:
            # ROFL mode: build transaction for rofl_util with retry logic
            tx_params: TxParams = {
                "from": "0x0000000000000000000000000000000000000000",  # ROFL will override
                "gas": 3000000,
                "gasPrice": self.contract_util.w3.eth.gas_price,
                "value": Wei(0),
            }
            tx_data = contract.functions.processPayment(
                receipt_proof_struct
            ).build_transaction(tx_params)

            # Retry loop for FuturePriceTimestamp errors
            # Note: No return after loop - all paths return within the loop body
            for attempt in range(FUTURE_PRICE_MAX_RETRIES):
                try:
                    success = await self.rofl_util.submit_tx(tx_data)
                    if success:
                        logger.info("Proof submitted successfully via ROFL")
                        return "ROFL_SUBMITTED"
                    else:
                        logger.error("Failed to submit proof via ROFL (no success)")
                        return None
                except Exception as e:
                    error_msg = str(e)
                    if DUPLICATE_PAYMENT_ERROR_B64 in error_msg:
                        # Payment already processed - treat as success
                        logger.info(
                            "DuplicatePayment error - payment was already processed, "
                            "marking as complete"
                        )
                        return "ALREADY_PROCESSED"
                    elif FUTURE_PRICE_TIMESTAMP_ERROR_B64 in error_msg:
                        remaining = FUTURE_PRICE_MAX_RETRIES - attempt - 1
                        if remaining > 0:
                            logger.warning(
                                f"FuturePriceTimestamp error (oracle ahead of block), "
                                f"retrying in {FUTURE_PRICE_RETRY_DELAY}s... "
                                f"({remaining} retries left)"
                            )
                            await asyncio.sleep(FUTURE_PRICE_RETRY_DELAY)
                            continue
                        else:
                            logger.error(
                                f"FuturePriceTimestamp error persisted after "
                                f"{FUTURE_PRICE_MAX_RETRIES} attempts, giving up: {error_msg}"
                            )
                            return None
                    else:
                        # Non-retryable error
                        logger.error(f"ROFL submission failed with error: {error_msg}")
                        return None
        else:
            # Local mode
            tx_hash = contract.functions.processPayment(receipt_proof_struct).transact(
                {"gas": 3000000, "gasPrice": self.contract_util.w3.eth.gas_price}
            )
            logger.info(f"Proof submitted locally: {Web3.to_hex(tx_hash)}")
            return Web3.to_hex(tx_hash)

    async def process_payment_event(
        self, payment_event: PaymentEvent, paymaster_address: str
    ) -> str:
        """
        Complete flow: generate and submit proof for a PaymentInitiated event.

        Args:
            payment_event: The PaymentEvent object containing tx_hash and block_number
            paymaster_address: Address of the CrossChainPaymaster contract

        Returns:
            Transaction hash of the proof submission
        """
        logger.info(
            f"Processing payment event with tx_hash={payment_event.tx_hash}, block={payment_event.block_number}"
        )
        proof = await self.generate_proof(payment_event)
        return await self.submit_proof(proof, paymaster_address)

    def _get_block_receipts(self, block_number: int) -> list[TxReceipt]:
        """
        Get all receipts for a block using eth_getBlockReceipts.

        Args:
            block_number: The block number

        Returns:
            List of transaction receipts

        Raises:
            ValueError: If block receipts cannot be fetched
        """
        try:
            receipts = self.source_provider.execute_with_failover(
                lambda w3: w3.eth.get_block_receipts(block_number)
            )
        except Exception as e:
            logger.error(f"Failed to fetch receipts for block {block_number}: {e}")
            raise ValueError(
                f"Failed to fetch receipts for block {block_number}"
            ) from e

        if receipts is None:
            logger.error(f"get_block_receipts returned None for block {block_number}")
            raise ValueError(f"Block receipts unavailable for block {block_number}")

        # Empty receipts list is valid (e.g., empty blocks) but worth logging
        if not receipts:
            logger.warning(f"Block {block_number} contains no receipts (empty block)")
        else:
            logger.info(f"Fetched {len(receipts)} receipts from block {block_number}")

        return receipts
