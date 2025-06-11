// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title TransactionHandler
 * @dev Contract for recording and tracking token transfers between buyers and sellers
 */
contract TransactionHandler {
    // Token details
    address public tokenAddress;
    uint256 public tokenId;
    
    // Structure to store transaction details
    struct Transaction {
        address buyer;
        address[] sellers;
        uint256[] amounts;
        uint256 timestamp;
        uint256 totalAmount;
    }
    
    // Array to store all transactions
    Transaction[] private transactions;
    
    // Events for logging
    event PurchaseRecorded(
        address indexed buyer,
        address[] sellers,
        uint256[] amounts,
        uint256 timestamp,
        uint256 totalAmount
    );
    
    /**
     * @dev Constructor to set the token details
     * @param _tokenAddress Address of the token (Greeno)
     * @param _tokenId Token ID in the Hedera network
     */
    constructor(address _tokenAddress, uint256 _tokenId) {
        tokenAddress = _tokenAddress;
        tokenId = _tokenId;
    }
    
    /**
     * @dev Record a purchase transaction after token transfer has been completed
     * @param buyer Address of the buyer
     * @param sellers Array of seller addresses
     * @param amounts Array of token amounts per seller
     */
    function recordPurchase(
        address buyer,
        address[] memory sellers,
        uint256[] memory amounts
    ) external {
        // Validate inputs
        require(sellers.length > 0, "Must have at least one seller");
        require(sellers.length == amounts.length, "Sellers and amounts arrays must be same length");
        
        // Calculate total amount
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
        }
        
        // Create transaction record
        Transaction memory newTransaction = Transaction({
            buyer: buyer,
            sellers: sellers,
            amounts: amounts,
            timestamp: block.timestamp,
            totalAmount: totalAmount
        });
        
        // Add to history
        transactions.push(newTransaction);
        
        // Emit event
        emit PurchaseRecorded(
            buyer,
            sellers,
            amounts,
            block.timestamp,
            totalAmount
        );
    }
    
    /**
     * @dev Get the total number of transactions
     * @return Number of transactions recorded
     */
    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }
    
    /**
     * @dev Get basic information about a specific transaction
     * @param index Index of the transaction
     * @return buyer Address of the buyer
     * @return timestamp When the transaction was recorded
     * @return totalAmount Total amount of tokens transferred
     */
    function getTransaction(uint256 index) 
        external 
        view 
        returns (
            address buyer,
            uint256 timestamp,
            uint256 totalAmount
        ) 
    {
        require(index < transactions.length, "Transaction index out of bounds");
        
        Transaction storage txData = transactions[index];
        return (
            txData.buyer,
            txData.timestamp,
            txData.totalAmount
        );
    }
    
    /**
     * @dev Get detailed information about a specific transaction including sellers and amounts
     * @param index Index of the transaction
     * @return buyer Address of the buyer
     * @return sellers Array of seller addresses
     * @return amounts Array of token amounts
     * @return timestamp When the transaction was recorded
     * @return totalAmount Total amount of tokens transferred
     */
    function getTransactionDetails(uint256 index) 
        external 
        view 
        returns (
            address buyer,
            address[] memory sellers,
            uint256[] memory amounts,
            uint256 timestamp,
            uint256 totalAmount
        ) 
    {
        require(index < transactions.length, "Transaction index out of bounds");
        
        Transaction storage txData = transactions[index];
        return (
            txData.buyer,
            txData.sellers,
            txData.amounts,
            txData.timestamp,
            txData.totalAmount
        );
    }
    
    /**
     * @dev Get all transactions for a specific buyer
     * @param buyerAddress Address of the buyer
     * @return indices Array of transaction indices
     */
    function getTransactionsByBuyer(address buyerAddress) 
        external 
        view 
        returns (uint256[] memory indices) 
    {
        // Count transactions by this buyer
        uint256 count = 0;
        for (uint256 i = 0; i < transactions.length; i++) {
            if (transactions[i].buyer == buyerAddress) {
                count++;
            }
        }
        
        // Create result array
        uint256[] memory result = new uint256[](count);
        
        // Fill result array
        uint256 resultIndex = 0;
        for (uint256 i = 0; i < transactions.length; i++) {
            if (transactions[i].buyer == buyerAddress) {
                result[resultIndex] = i;
                resultIndex++;
            }
        }
        
        return result;
    }
    
    /**
     * @dev Get all transactions for a specific seller
     * @param sellerAddress Address of the seller
     * @return indices Array of transaction indices
     * @return amounts Array of corresponding amounts for each transaction
     */
    function getTransactionsBySeller(address sellerAddress) 
        external 
        view 
        returns (uint256[] memory indices, uint256[] memory amounts) 
    {
        // Count transactions including this seller
        uint256 count = 0;
        for (uint256 i = 0; i < transactions.length; i++) {
            for (uint256 j = 0; j < transactions[i].sellers.length; j++) {
                if (transactions[i].sellers[j] == sellerAddress) {
                    count++;
                    break;
                }
            }
        }
        
        // Create result arrays
        uint256[] memory resultIndices = new uint256[](count);
        uint256[] memory resultAmounts = new uint256[](count);
        
        // Fill result arrays
        uint256 resultIndex = 0;
        for (uint256 i = 0; i < transactions.length; i++) {
            for (uint256 j = 0; j < transactions[i].sellers.length; j++) {
                if (transactions[i].sellers[j] == sellerAddress) {
                    resultIndices[resultIndex] = i;
                    resultAmounts[resultIndex] = transactions[i].amounts[j];
                    resultIndex++;
                    break;
                }
            }
        }
        
        return (resultIndices, resultAmounts);
    }
}