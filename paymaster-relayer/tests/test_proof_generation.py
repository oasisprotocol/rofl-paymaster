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

from web3 import Web3

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from paymaster_relayer.models import PaymentEvent
from paymaster_relayer.proof_manager import ProofManager
from paymaster_relayer.utils.contract_utility import ContractUtility


async def test_proof_matches_typescript():
    """
    Test that Python proof generation matches TypeScript proof.json.
    """
    print("🧪 Testing proof generation against TypeScript reference")

    # Load TypeScript proof for comparison
    proof_path = Path(__file__).parent.parent.parent / "pay" / "proof.json"
    if not proof_path.exists():
        print(f"❌ TypeScript proof not found at {proof_path}")
        print("   Please run 'hardhat pay:generate-proof' in contracts to create proof.json")
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
        "SOURCE_RPC_URL", "https://ethereum-sepolia.publicnode.com"
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
    payment_topic = Web3.keccak(text="PaymentInitiated(address,address,address,uint256,bytes32)")
    payer = None
    event_block_number = None

    for log in receipt["logs"]:
        if len(log["topics"]) >= 1 and log["topics"][0] == payment_topic:
            # Extract payer from topics[1] if present
            if len(log["topics"]) > 1:
                payer_bytes = log["topics"][1][-20:]  # Last 20 bytes is the address
                payer = Web3.to_checksum_address(payer_bytes)
            event_block_number = receipt["blockNumber"]
            print(f"   Found PaymentInitiated event - Payer: {payer}, Block: {event_block_number}")
            break

    if payer is None and event_block_number is None:
        print("❌ PaymentInitiated event not found in transaction")
        return False

    # Initialize utilities
    # Use a dummy RPC for ContractUtility since we only need ABI loading
    contract_util = ContractUtility(
        rpc_url="http://localhost:8545"
    )  # Dummy URL for ABI-only mode

    # Create ProofManager
    proof_manager = ProofManager(
        w3_source=web3_source,
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
    Test error handling in proof generation.
    """
    print("\n🧪 Testing error handling")

    # Initialize Web3 connection
    source_rpc = os.environ.get(
        "SOURCE_RPC_URL", "https://ethereum-sepolia.publicnode.com"
    )
    web3_source = Web3(Web3.HTTPProvider(source_rpc))

    if not web3_source.is_connected():
        print("⚠️  Skipping error tests - no connection to source chain")
        return

    # Initialize ProofManager
    contract_util = ContractUtility(
        rpc_url="http://localhost:8545"
    )  # Dummy URL for ABI-only mode
    proof_manager = ProofManager(
        w3_source=web3_source,
        contract_util=contract_util,
        rofl_util=None,  # Testing without ROFL
    )

    # Test with invalid transaction hash
    print("\n📍 Testing with invalid transaction hash...")
    try:
        invalid_event = PaymentEvent(
            tx_hash="0xinvalid",
            block_number=0,
            payer="0x0000000000000000000000000000000000000000",
            recipient="0x0000000000000000000000000000000000000000",
            token="0x0000000000000000000000000000000000000000",
            amount=0,
        )
        await proof_manager.generate_proof(invalid_event)
        print("❌ Should have raised an error for invalid hash")
    except Exception as e:
        print(f"✅ Correctly raised error: {type(e).__name__}")

    # Test with non-existent transaction
    print("\n📍 Testing with non-existent transaction...")
    try:
        fake_hash = "0x" + "0" * 64
        fake_event = PaymentEvent(
            tx_hash=fake_hash,
            block_number=0,
            payer="0x0000000000000000000000000000000000000000",
            recipient="0x0000000000000000000000000000000000000000",
            token="0x0000000000000000000000000000000000000000",
            amount=0,
        )
        await proof_manager.generate_proof(fake_event)
        print("❌ Should have raised an error for non-existent tx")
    except Exception as e:
        print(f"✅ Correctly raised error: {type(e).__name__}")

    print("\n✅ Error handling tests completed")


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
