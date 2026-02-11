"""
Test proof generation against TypeScript reference implementation.

This test ensures that the Python proof generation matches the TypeScript
implementation byte-for-byte, which is critical for cross-chain verification.
"""

import asyncio
import json
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from web3 import Web3

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from paymaster_relayer.models import PaymentEvent
from paymaster_relayer.proof_manager import ProofManager
from paymaster_relayer.utils.contract_utility import ContractUtility
from paymaster_relayer.utils.multi_rpc_provider import MultiRpcProvider


@pytest.fixture(autouse=True)
def mock_threading_event_for_tests():
    """
    Mock threading.Event to prevent infinite retry in tests.

    This fixture ensures that MultiRpcProvider instances created in tests
    will fail fast instead of retrying infinitely when RPC connections fail.
    """
    with patch(
        "paymaster_relayer.utils.multi_rpc_provider.threading.Event"
    ) as mock_event_class:
        # Each test gets its own mock event instance with fresh counter
        def create_mock_event():
            mock_event = MagicMock()
            # Allow up to 10 wait calls per event instance
            wait_count = [0]

            def limit_retries(timeout=None):
                wait_count[0] += 1
                return wait_count[0] > 10  # Signal shutdown after 10 attempts

            mock_event.is_set.return_value = False
            mock_event.wait.side_effect = limit_retries
            return mock_event

        # Return a new mock event for each call
        mock_event_class.side_effect = create_mock_event
        yield mock_event_class


async def test_proof_matches_typescript():
    """
    Test that Python proof generation matches TypeScript proof.json.
    """
    print("🧪 Testing proof generation against TypeScript reference")

    # Load TypeScript proof for comparison
    proof_path = Path(__file__).parent.parent.parent / "pay" / "proof.json"
    if not proof_path.exists():
        print(f"❌ TypeScript proof not found at {proof_path}")
        print(
            "   Please run 'hardhat pay:generate-proof' in contracts to create proof.json"
        )
        return False

    with open(proof_path) as f:
        typescript_proof = json.load(f)

    print(f"📋 TypeScript proof loaded from {proof_path}")
    print(f"   Chain ID: {typescript_proof[0]}")
    print(f"   Block Number: {typescript_proof[1]}")
    print(f"   Log Index: {typescript_proof[7]}")

    # Extract transaction details from proof
    # The proof.json doesn't contain tx hash, so we need to get it from env or hardcode
    # For testing, we'll use the known transaction from the proof
    # Updated to use the newer transaction
    tx_hash = "0x9b1003047adc2a6a1f0c4fb5398ee40108097f4a1716684af1d4e77d21603546"

    # Initialize Web3 connection to source chain
    source_rpc = os.environ.get(
        "SOURCE_RPC_URLS", "https://ethereum-sepolia.publicnode.com"
    )
    print(f"\n🌐 Connecting to source chain: {source_rpc}")

    web3_source = Web3(Web3.HTTPProvider(source_rpc))
    if not web3_source.is_connected():
        print("❌ Failed to connect to source chain")
        return False

    # Get transaction receipt to extract PaymentInitiated event details
    print("📥 Fetching transaction receipt to get PaymentInitiated event details...")
    receipt = web3_source.eth.get_transaction_receipt(tx_hash)
    if not receipt:
        print("❌ Transaction receipt not found")
        return False

    # Find the PaymentInitiated event in the logs
    # PaymentInitiated event signature
    payment_topic = Web3.keccak(
        text="PaymentInitiated(address,address,address,uint256,bytes32)"
    )
    payer = None
    event_block_number = None

    for log in receipt["logs"]:
        if len(log["topics"]) >= 1 and log["topics"][0] == payment_topic:
            # Extract payer from topics[1] if present
            if len(log["topics"]) > 1:
                payer_bytes = log["topics"][1][-20:]  # Last 20 bytes is the address
                payer = Web3.to_checksum_address(payer_bytes)
            event_block_number = receipt["blockNumber"]
            print(
                f"   Found PaymentInitiated event - Payer: {payer}, Block: {event_block_number}"
            )
            break

    if payer is None and event_block_number is None:
        print("❌ PaymentInitiated event not found in transaction")
        return False

    # Initialize utilities
    # Use a dummy RPC for ContractUtility since we only need ABI loading
    contract_util = ContractUtility(
        rpc_url="http://localhost:8545"
    )  # Dummy URL for ABI-only mode

    # Create ProofManager with multi-RPC provider
    source_provider = MultiRpcProvider([source_rpc])
    proof_manager = ProofManager(
        source_provider=source_provider,
        contract_util=contract_util,
        rofl_util=None,  # Testing without ROFL
    )

    # Create PaymentEvent object for proof generation
    payment_event = PaymentEvent(
        tx_hash=tx_hash,
        block_number=event_block_number,
        payer=payer or "0x0000000000000000000000000000000000000000",
        recipient="0x0000000000000000000000000000000000000000",
        token="0x0000000000000000000000000000000000000000",
        amount=0,
    )

    # Generate proof with PaymentEvent object
    print(f"\n🔮 Generating proof for transaction {tx_hash}")
    print(f"   Using block: {event_block_number}")
    try:
        python_proof = await proof_manager.generate_proof(payment_event)
        print("✅ Proof generated successfully")
    except Exception as e:
        print(f"❌ Failed to generate proof: {e}")
        return False

    # Compare proofs
    print("\n📊 Comparing Python and TypeScript proofs:")

    # Compare each element
    elements = [
        "Chain ID",
        "Block Number",
        "Encoded Block Header",
        "Ancestral Block Number",
        "Ancestral Block Headers",
        "Merkle Proof",
        "Transaction Index",
        "Log Index",
    ]

    all_match = True
    for i, element_name in enumerate(elements):
        python_val = python_proof[i]
        typescript_val = typescript_proof[i]

        # Special handling for arrays and hex strings
        if isinstance(python_val, list) and isinstance(typescript_val, list):
            # Compare arrays element by element
            if len(python_val) != len(typescript_val):
                print(
                    f"❌ {element_name}: Length mismatch (Python: {len(python_val)}, TypeScript: {len(typescript_val)})"
                )
                all_match = False
                match = False  # Set match to False for length mismatches
            else:
                # Compare each element, normalizing hex strings
                match = all(
                    normalize_hex(p) == normalize_hex(t)
                    for p, t in zip(python_val, typescript_val, strict=True)
                )

            if match:
                print(f"✅ {element_name}: Match ({len(python_val)} elements)")
            else:
                print(f"❌ {element_name}: Content mismatch")
                all_match = False

        else:
            # Compare single values, normalizing hex strings
            python_normalized = normalize_hex(python_val)
            typescript_normalized = normalize_hex(typescript_val)

            if python_normalized == typescript_normalized:
                if isinstance(python_val, str) and len(python_val) > 20:
                    print(f"✅ {element_name}: Match ({python_normalized[:10]}...)")
                else:
                    print(f"✅ {element_name}: Match ({python_normalized})")
            else:
                print(f"❌ {element_name}: Mismatch")
                if isinstance(python_val, str) and len(python_normalized) > 50:
                    print(f"   Python:     {python_normalized[:50]}...")
                    print(f"   TypeScript: {typescript_normalized[:50]}...")
                else:
                    print(f"   Python:     {python_normalized}")
                    print(f"   TypeScript: {typescript_normalized}")
                all_match = False

    # Final result
    print("\n" + "=" * 50)
    if all_match:
        print("🎉 SUCCESS: Python proof matches TypeScript exactly!")
        return True
    else:
        print("❌ FAILURE: Proofs do not match")
        print("\nDebug information:")
        print(f"Python proof length: {len(str(python_proof))}")
        print(f"TypeScript proof length: {len(str(typescript_proof))}")
        return False


def normalize_hex(value):
    """
    Normalize hex strings for comparison.

    Args:
        value: Value to normalize

    Returns:
        Normalized value for comparison
    """
    if isinstance(value, str) and value.startswith("0x"):
        # Remove 0x prefix and convert to lowercase
        return value[2:].lower()
    elif isinstance(value, bytes):
        return value.hex().lower()
    elif isinstance(value, list):
        return [normalize_hex(v) for v in value]
    else:
        return value


async def test_proof_generation_errors():
    """
    Test error handling in proof generation with mocked Web3 layer.

    This test verifies that ProofManager properly propagates errors from
    the RPC layer without making real network connections.
    """
    # Mock ContractUtility (only needs ABIs)
    contract_util = ContractUtility(rpc_url="http://localhost:8545")

    # Mock MultiRpcProvider to avoid real network connections
    mock_provider = MagicMock(spec=MultiRpcProvider)

    # Create ProofManager with mocked provider
    proof_manager = ProofManager(
        source_provider=mock_provider,
        contract_util=contract_util,
        rofl_util=None,
    )

    # Test 1: Invalid transaction hash
    # Mock execute_with_failover to raise ValueError when w3.eth.get_transaction_receipt is called
    def mock_invalid_hash_operation(operation):
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_receipt.side_effect = ValueError("Invalid transaction hash format")
        return operation(mock_w3)

    mock_provider.execute_with_failover.side_effect = mock_invalid_hash_operation

    invalid_event = PaymentEvent(
        tx_hash="0xinvalid",
        block_number=0,
        payer="0x0000000000000000000000000000000000000000",
        recipient="0x0000000000000000000000000000000000000000",
        token="0x0000000000000000000000000000000000000000",
        amount=0,
    )

    with pytest.raises(ValueError, match="Invalid transaction hash format"):
        await proof_manager.generate_proof(invalid_event)

    # Test 2: Non-existent transaction
    # Mock execute_with_failover to raise ValueError for non-existent transaction
    def mock_nonexistent_tx_operation(operation):
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_receipt.side_effect = ValueError("Transaction not found")
        return operation(mock_w3)

    mock_provider.execute_with_failover.side_effect = mock_nonexistent_tx_operation

    fake_hash = "0x" + "0" * 64
    fake_event = PaymentEvent(
        tx_hash=fake_hash,
        block_number=0,
        payer="0x0000000000000000000000000000000000000000",
        recipient="0x0000000000000000000000000000000000000000",
        token="0x0000000000000000000000000000000000000000",
        amount=0,
    )

    with pytest.raises(ValueError, match="Transaction not found"):
        await proof_manager.generate_proof(fake_event)


async def main():
    """
    Run all proof generation tests.
    """
    print("=" * 50)
    print("PROOF GENERATION TEST SUITE")
    print("=" * 50)

    # Run main compatibility test
    success = await test_proof_matches_typescript()

    # Run error handling tests
    await test_proof_generation_errors()

    # Summary
    print("\n" + "=" * 50)
    if success:
        print("✅ All tests passed!")
        return 0
    else:
        print("❌ Some tests failed")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
