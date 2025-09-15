"""
Shared data models for the Paymaster Relayer.

This module contains data classes and types used across the relayer components.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PaymentEvent:
    """Represents a PaymentInitiated event from the source chain.

    Attributes:
        tx_hash: Transaction hash where the event was emitted
        block_number: Block number where the event occurred
        payer: Address that initiated the payment (depositor)
        recipient: Address on Sapphire to receive ROSE
        token: ERC20 token address deposited on source chain
        amount: Amount deposited
    """

    tx_hash: str
    block_number: int
    payer: str
    recipient: str
    token: str
    amount: int
