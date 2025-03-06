// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Counter {
    uint256 private value;

    event ValueChanged(uint256 newValue);

    // Payable fallback function to receive funds
    receive() external payable {}

    // Increment the counter
    function increment() public {
        value += 1;
        emit ValueChanged(value);
    }

    // Get the current counter value
    function getValue() public view returns (uint256) {
        return value;
    }
    
    // For NIL external verification
    function verifyExternal(
        uint256 hash,
        bytes memory authData
    ) external pure returns (bool) {
        return true;
    }
} 