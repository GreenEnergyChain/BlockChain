require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { 
    Client, PrivateKey, TokenCreateTransaction, AccountBalanceQuery, 
    TokenMintTransaction, TransferTransaction, TokenDeleteTransaction,
    AccountId, ContractFunctionParameters, ContractCreateFlow,
    ContractExecuteTransaction, ContractCallQuery, TokenId,
    TokenAssociateTransaction, Hbar
} = require("@hashgraph/sdk");
const Transaction = require('./models/Transaction');
const fs = require("fs");
const solc = require("solc");
const mongoose = require("mongoose");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// Initialize MongoDB connection
mongoose.connect("mongodb://localhost:27017/GreenEnergynotchainbutchain", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => console.error("❌ MongoDB Connection Error:", err));

// Hedera client setup
const operatorAccountId = process.env.ACCOUNT_ID || "0.0.5492800";
const operatorPrivateKey = process.env.PRIVATE_KEY || "3030020100300706052b8104000a0422042041d5effc45e78cc1efec244a5de9520743f1ddd5b70b2a7f842ac63928d5e4e5";
const client = Client.forTestnet();
client.setOperator(operatorAccountId, PrivateKey.fromString(operatorPrivateKey));

// Greeno token ID
const tokenId = "0.0.5611505";

// Smart Contract Handler Class
class SmartContractHandler {
    constructor(client, operatorId, operatorKey, tokenId) {
        this.client = client;
        this.operatorId = operatorId;
        this.operatorKey = operatorKey;
        this.greenoTokenId = TokenId.fromString(tokenId);
        this.contractId = "0.0.5981110";
        //this.contractId = null;
    }

    
    async compileContract() {
        console.log("Compiling Solidity contract...");
        const source = fs.readFileSync("./smartContract/TransactionHandler.sol", "utf8");

        const input = {
            language: "Solidity",
            sources: {
                "TransactionHandler.sol": { content: source },
            },
            settings: {
                outputSelection: {
                    "*": {
                        "*": ["abi", "evm.bytecode"],
                    },
                },
            },
        };

        try {
            const output = JSON.parse(solc.compile(JSON.stringify(input)));

            if (output.errors) {
                const hasError = output.errors.some(err => err.severity === 'error');
                output.errors.forEach(err => {
                    if (err.severity === 'error') {
                        console.error("Compilation Error:", err);
                    } else {
                        console.warn("Compilation Warning:", err.formattedMessage);
                    }
                });
                
                if (hasError) {
                    throw new Error("Contract compilation failed with errors.");
                }
            }

            const bytecode = output.contracts["TransactionHandler.sol"]["TransactionHandler"].evm.bytecode.object;
            const abi = output.contracts["TransactionHandler.sol"]["TransactionHandler"].abi;

            fs.writeFileSync("./TransactionHandler.bin", bytecode);
            fs.writeFileSync("./TransactionHandler.abi.json", JSON.stringify(abi, null, 2));

            console.log("✅ Contract compiled successfully");
            return { bytecode, abi };
        } catch (err) {
            console.error("Compilation failed:", err);
            throw err;
        }
    }

    async getBytecode() {
        try {
            if (fs.existsSync("./TransactionHandler.bin")) {
                const bytecode = fs.readFileSync("./TransactionHandler.bin", "utf8");
                if (bytecode && bytecode.length > 0) {
                    console.log("Using existing bytecode from TransactionHandler.bin");
                    return bytecode;
                }
            }
            console.log("No valid bytecode found, compiling contract...");
            return (await this.compileContract()).bytecode;
        } catch (error) {
            console.log("Error reading bytecode, compiling contract...");
            return (await this.compileContract()).bytecode;
        }
    }

    async deployContract() {
        try {
            const bytecode = await this.getBytecode();
            const tokenSolidityAddress = "0x0000000000000000000000000000000000559ff1";

            const contractCreate = new ContractCreateFlow()
                .setGas(3000000)
                .setBytecode(bytecode)
                .setConstructorParameters(
                    new ContractFunctionParameters()
                        .addAddress(tokenSolidityAddress)
                        .addUint256(this.greenoTokenId.num.toNumber())
                );

            console.log("Deploying contract...");
            const txResponse = await contractCreate.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);
            this.contractId = receipt.contractId;

            console.log("✅ Contract deployed with ID:", this.contractId.toString());
            return this.contractId;
        } catch (error) {
            console.error("Error deploying contract:", error);
            throw error;
        }
    }
    

async transferTokensToSellers(buyerAccountId, buyerPrivateKey, sellers, tokenAmounts) {
    try {
        console.log(`Transferring tokens from buyer ${buyerAccountId} to sellers...`);
        
        // Input validation 
        if (!buyerAccountId || !buyerPrivateKey || !sellers || !tokenAmounts) {
            throw new Error("Missing required parameters");
        }

        const sellerAccounts = Array.isArray(sellers) ? sellers : [sellers];
        const amounts = Array.isArray(tokenAmounts) ? tokenAmounts : [tokenAmounts];

        if (sellerAccounts.length !== amounts.length) {
            throw new Error("Sellers and amounts arrays must have same length");
        }
        
        // Create and configure transaction
        const transaction = new TransferTransaction();
        let totalAmount = 0;

        // Process amounts
        amounts.forEach(amount => totalAmount += Number(amount));

        // Add transfers
        transaction.addTokenTransfer(this.greenoTokenId, buyerAccountId, -totalAmount);
        
        for (let i = 0; i < sellerAccounts.length; i++) {
            const sellerAccountId = AccountId.fromString(sellerAccounts[i]);
            const amount = Number(amounts[i]);
            transaction.addTokenTransfer(this.greenoTokenId, sellerAccountId, amount);
        }

        // IMPORTANT FIX: Use the buyer's private key for signing, not the operator key
        const signedTx = await transaction
            .freezeWith(this.client)
            .sign(buyerPrivateKey); // Sign with buyerPrivateKey, not this.operatorKey
            
        const txResponse = await signedTx.execute(this.client);
        const receipt = await txResponse.getReceipt(this.client);
        
        console.log(`✅ Transfer status: ${receipt.status.toString()}`);
        
        return {
            status: receipt.status.toString(),
            transactionId: txResponse.transactionId.toString(),
            receipt: receipt
        };

    } catch (error) {
        console.error("Transfer failed:", error);
        throw error;
    }
}


async purchaseTokens(buyerAccountId, sellerAccountIds, tokenAmounts, buyerPrivateKey = null) {
    try {
        if (!this.contractId) {
            throw new Error("Contract not deployed. Call deployContract() first.");
        }

        // Ensure we have arrays
        const sellers = Array.isArray(sellerAccountIds) ? sellerAccountIds : [sellerAccountIds];
        const amounts = Array.isArray(tokenAmounts) ? tokenAmounts : [tokenAmounts];

        // Convert amounts to integers
        const integerAmounts = amounts.map(amount => {
            const num = Number(amount);
            if (isNaN(num)) throw new Error(`Invalid amount: ${amount}`);
            return Math.floor(num * 100); // Assuming 2 decimal places
        });

        // If buyer's private key is provided, use it for the transfer
        // Otherwise, fall back to the operator key
        const privateKeyToUse = buyerPrivateKey || this.operatorKey;

        // Execute token transfer with converted amounts
        await this.transferTokensToSellers(
            buyerAccountId, 
            privateKeyToUse, 
            sellers, 
            integerAmounts
        );
        
        // Record purchase in contract
        const buyerAddress = AccountId.fromString(buyerAccountId).toSolidityAddress();
        const sellerAddresses = sellers.map(id => 
            AccountId.fromString(id).toSolidityAddress()
        );
        
        const tx = await new ContractExecuteTransaction()
            .setContractId(this.contractId)
            .setGas(3000000)
            .setFunction(
                "recordPurchase",
                new ContractFunctionParameters()
                    .addAddress(buyerAddress)
                    .addAddressArray(sellerAddresses)
                    .addUint256Array(integerAmounts)
            )
            .execute(this.client);
            
        const receipt = await tx.getReceipt(this.client);
        return receipt;
    } catch (error) {
        console.error("Error during tokens purchase:", error);
        throw error;
    }
}

    async getTransactionHistory() {
        try {
            if (!this.contractId) {
                throw new Error("Contract not deployed. Call deployContract() first.");
            }

            const query = new ContractCallQuery()
                .setContractId(this.contractId)
                .setGas(100000)
                .setFunction("getTransactionCount");
                
            const countResult = await query.execute(this.client);
            const count = countResult.getUint256(0);
            
            const transactions = [];
            
            for (let i = 0; i < count; i++) {
                const txQuery = new ContractCallQuery()
                    .setContractId(this.contractId)
                    .setGas(100000)
                    .setFunction("getTransaction", new ContractFunctionParameters().addUint256(i));
                    
                const txResult = await txQuery.execute(this.client);
                
                const tx = {
                    buyer: AccountId.fromSolidityAddress(txResult.getAddress(0)).toString(),
                    timestamp: txResult.getUint256(1).toNumber(),
                    totalAmount: txResult.getUint256(2).toNumber()
                };
                
                transactions.push(tx);
            }
            
            return transactions;
        } catch (error) {
            console.error("Error retrieving transaction history:", error);
            throw error;
        }
    }

    async associateTokenWithAccount(accountId, privateKey) {
        try {
            const transaction = await new TokenAssociateTransaction()
                .setAccountId(accountId)
                .setTokenIds([this.greenoTokenId])
                .freezeWith(this.client)
                .sign(privateKey);
                
            const txResponse = await transaction.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);
            
            console.log(`Token association status: ${receipt.status}`);
            return receipt;
        } catch (error) {
            if (error.message.includes("TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT")) {
                console.log("Token is already associated with this account.");
                return { status: "ALREADY_ASSOCIATED" };
            }
            throw error;
        }
    }
}

// Initialize Smart Contract Handler
const contractHandler = new SmartContractHandler(
    client,
    operatorAccountId,
    PrivateKey.fromString(operatorPrivateKey),
    tokenId
);

/*
// Deploy contract on startup
(async () => {
    try {
        await contractHandler.deployContract();
        console.log("✅ Smart Contract Handler initialized");
    } catch (error) {
        console.error("❌ Error initializing Smart Contract Handler:", error);
    }
})();
*/

/* ------------------------------------ ADMIN API --------------------------------------------- */

// 📌 API to Create a Token
app.post("/createToken", async (req, res) => {
    try {
        const adminKey = PrivateKey.fromString(operatorPrivateKey);
        const supplyKey = PrivateKey.fromString(operatorPrivateKey);

        const transaction = await new TokenCreateTransaction()
            .setTokenName("Greeno")
            .setTokenSymbol("GRE")
            .setTreasuryAccountId(operatorAccountId)
            .setInitialSupply(1000000)
            .setAdminKey(adminKey)
            .setSupplyKey(supplyKey)
            .setFreezeKey(adminKey)
            .setWipeKey(adminKey)
            .freezeWith(client)
            .sign(adminKey);

        const txResponse = await transaction.execute(client);
        const receipt = await txResponse.getReceipt(client);
        const tokenId = receipt.tokenId;

        console.log(`🚀 Token Created Successfully! Token ID: ${tokenId}`);
        res.json({ tokenId: tokenId.toString() });
    } catch (error) {
        console.error("❌ Error creating token:", error);
        res.status(500).json({ error: error.message });
    }
});

// 📌 API to Get Token Balance
const { TokenInfoQuery } = require("@hashgraph/sdk");
app.post("/getTokenSupply", async (req, res) => {
    try {
        const { tokenId } = req.body;

        if (!tokenId) {
            return res.status(400).json({ error: "Token ID is required" });
        }

        const tokenInfo = await new TokenInfoQuery()
            .setTokenId(tokenId)
            .execute(client);

        const totalSupply = tokenInfo.totalSupply.toString();

        console.log(`📊 Total Supply of Token ${tokenId}: ${totalSupply}`);
        res.json({ tokenId, totalSupply });
    } catch (error) {
        console.error("❌ Error fetching token supply:", error);
        res.status(500).json({ error: error.message });
    }
});

// 📌 API to Mint New Tokens
app.post("/mintTokens", async (req, res) => {
    const { amount,userAccountId } = req.body;

    try {
        const transaction = await new TokenMintTransaction()
            .setTokenId(tokenId)
            .setAmount(amount)
            .freezeWith(client)
            .sign(PrivateKey.fromString(operatorPrivateKey));

        const txResponse = await transaction.execute(client);
        const receipt = await txResponse.getReceipt(client);
        
        
        const transferTx = await new TransferTransaction()
            .addTokenTransfer(tokenId, process.env.ACCOUNT_ID, -amount) // From treasury
            .addTokenTransfer(tokenId, userAccountId, amount)      // To user
            .freezeWith(client)
            .sign(PrivateKey.fromString(operatorPrivateKey));

        const transferResponse = await transferTx.execute(client);
        const transferReceipt = await transferResponse.getReceipt(client);
        

        console.log(`✅ Minted ${amount} tokens! Status: ${receipt.status}`);
        console.log(`✅ tranfer ${amount} tokens! Status: ${transferReceipt.status}`);
        res.json({ message: `Minted ${amount} tokens`, status: receipt.status.toString() });
    } catch (error) {
        console.error("❌ Error minting tokens:", error);
        res.status(500).json({ error: error.message });
    }
});

// 📌 API to Burn Tokens
const { TokenBurnTransaction } = require("@hashgraph/sdk");
app.post("/burnTokens", async (req, res) => {
    try {
        const { tokenId, amount } = req.body;

        const transaction = await new TokenBurnTransaction()
            .setTokenId(tokenId)
            .setAmount(amount)
            .freezeWith(client)
            .sign(PrivateKey.fromString(operatorPrivateKey));

        const txResponse = await transaction.execute(client);
        const receipt = await txResponse.getReceipt(client);

        console.log(`🔥 Burned ${amount} tokens! Status: ${receipt.status}`);
        res.json({ message: `Burned ${amount} tokens`, status: receipt.status.toString() });
    } catch (error) {
        console.error("❌ Error burning tokens:", error);
        res.status(500).json({ error: error.message });
    }
});

// 📌 API to Delete a Token
app.post("/deleteToken", async (req, res) => {
    const { tokenId } = req.body;

    if (!tokenId) {
        return res.status(400).json({ error: "Token ID is required" });
    }

    try {
        const transaction = await new TokenDeleteTransaction()
            .setTokenId(tokenId)
            .freezeWith(client)
            .sign(PrivateKey.fromString(operatorPrivateKey));

        const txResponse = await transaction.execute(client);
        const receipt = await txResponse.getReceipt(client);

        if (receipt.status.toString() === "SUCCESS") {
            console.log(`✅ Token Deleted Successfully! Token ID: ${tokenId}`);
            res.json({ message: `Token ${tokenId} deleted successfully` });
        } else {
            res.status(500).json({ error: `Failed to delete token: ${receipt.status}` });
        }
    } catch (error) {
        console.error("❌ Error deleting token:", error);
        res.status(500).json({ error: error.message });
    }
});

/* ---------------------------------------  CLIENT API --------------------------------------------------- */

// 📌 API to connect the wallet and get balance in one API call
app.post("/connectProfile", async (req, res) => {
    const { accountId, privateKey } = req.body;

    try {
        const client = Client.forTestnet();
        const key = PrivateKey.fromString(privateKey);
        client.setOperator(accountId, key);

        console.log("🔐 Verifying key by performing dummy transaction...");

        const tx = await new TransferTransaction()
            .addHbarTransfer(accountId, new Hbar(-0))
            .addHbarTransfer(accountId, new Hbar(0))
            .execute(client);

        const receipt = await tx.getReceipt(client);
        console.log("✅ Verified. Transaction ID:", tx.transactionId.toString());

        res.json({
            success: true,
            message: "Private key is valid and matches the account.",
            transactionStatus: receipt.status.toString(),
        });
    } catch (error) {
        console.error("❌ Invalid key or signature:", error);
        res.status(401).json({
            success: false,
            message: "Invalid credentials — private key does not match account.",
            error: error.message,
        });
    }
});

// 📌 API to Check Token Balance for spec profile
app.get("/tokenBalance", async (req, res) => {
    try {
        const { operatorAccountId, operatorPrivateKey } = req.query;

        if (!operatorAccountId || !operatorPrivateKey) {
            return res.status(400).json({ error: "Missing operatorAccountId or operatorPrivateKey in query parameters." });
        }

        const client = Client.forTestnet();
        client.setOperator(operatorAccountId, PrivateKey.fromString(operatorPrivateKey));

        const balanceQuery = new AccountBalanceQuery().setAccountId(operatorAccountId);
        const balance = await balanceQuery.execute(client);

        const tokenBalance = balance.tokens.get(tokenId)?.toString() || "0";

        console.log(`💰 Token Balance for ${operatorAccountId}: ${tokenBalance} GRE`);
        res.json({ balance: tokenBalance });

    } catch (error) {
        console.error("❌ Error fetching token balance:", error);
        res.status(500).json({ error: error.message });
    }
});

// 📌 Smart Contract based Token Transfer API (Multiple Receivers)
app.post("/transferTokens", async (req, res) => {
    try {
        const { senderId, receiverIds, amounts, senderPrivateKey } = req.body;
        
        // Validate required fields with specific error messages
        if (!senderId) return res.status(400).json({ error: "Sender ID is required" });
        if (!receiverIds) return res.status(400).json({ error: "Receiver IDs are required" });
        if (!amounts) return res.status(400).json({ error: "Amounts are required" });
        if (!senderPrivateKey) return res.status(400).json({ error: "Sender private key is required" });

        // Convert to arrays if single values
        const receivers = Array.isArray(receiverIds) ? receiverIds : [receiverIds];
        const amountsArray = Array.isArray(amounts) ? amounts : [amounts];

        // Validate array lengths
        if (receivers.length !== amountsArray.length) {
            return res.status(400).json({ 
                error: `Mismatched array lengths: ${receivers.length} receivers but ${amountsArray.length} amounts provided` 
            });
        }

        // Validate account ID format
        const isValidAccountId = (id) => typeof id === 'string' && /^0\.0\.\d+$/.test(id);
        if (!isValidAccountId(senderId)) {
            return res.status(400).json({ error: `Invalid sender account ID format: ${senderId}` });
        }
        
        const invalidReceivers = receivers.filter(id => !isValidAccountId(id));
        if (invalidReceivers.length > 0) {
            return res.status(400).json({ 
                error: `Invalid receiver account ID(s): ${invalidReceivers.join(', ')}` 
            });
        }

        // Validate amounts are positive numbers
        const invalidAmounts = amountsArray.filter(amt => isNaN(amt) || Number(amt) <= 0);
        if (invalidAmounts.length > 0) {
            return res.status(400).json({ 
                error: `Invalid amount(s): ${invalidAmounts.join(', ')} - must be positive numbers` 
            });
        }

        // Parse the private key
        let privateKey;
        try {
            privateKey = PrivateKey.fromString(senderPrivateKey);
        } catch (keyError) {
            return res.status(400).json({ 
                error: "Invalid private key format",
                details: keyError.message 
            });
        }

        // Connect to Hedera testnet with sender's credentials
        const client = Client.forTestnet();
        client.setOperator(senderId, privateKey);

        // Ensure token is associated with sender's account
        try {
            const associationResult = await contractHandler.associateTokenWithAccount(
                senderId, 
                privateKey
            );
            
            if (associationResult.status === "ALREADY_ASSOCIATED") {
                console.log(`Token already associated with ${senderId}`);
            }
        } catch (assocError) {
            console.error("Association error:", assocError);
            return res.status(400).json({ 
                error: "Token association failed",
                details: assocError.message 
            });
        }

        // Execute the token transfer
        let transferReceipt;
        try {
            transferReceipt = await contractHandler.transferTokensToSellers(
                senderId,
                privateKey, // Pass the PrivateKey object directly
                receivers,
                amountsArray.map(amt => Number(amt))
            );
            
            if (transferReceipt.status !== "SUCCESS") {
                throw new Error(`Transfer failed with status: ${transferReceipt.status}`);
            }
        } catch (transferError) {
            console.error("Transfer error:", transferError);
            return res.status(400).json({ 
                error: "Token transfer failed",
                details: transferError.message.includes("status")
                    ? transferError.message
                    : "Check account balances and token associations"
            });
        }

        // Record the purchase in the smart contract
        let contractReceipt;
        try {
            contractReceipt = await contractHandler.purchaseTokens(
                senderId,
                receivers,
                amountsArray.map(amt => Number(amt))
            );
            
            if (contractReceipt.status.toString() !== "SUCCESS") {
                throw new Error(`Contract recording failed with status: ${contractReceipt.status.toString()}`);
            }
        } catch (contractError) {
            console.error("Contract error:", contractError);
            // Note: We don't fail the entire request here since tokens were already transferred
        }

        // Save transaction records
        try {
            const transactions = receivers.map((receiverId, i) => {
                const price = Number(amountsArray[i]);
                const power = price ;

                return new Transaction({
                    tokenId,
                    senderId,
                    receiverId,
                    power,
                    price,
                });
            });

            await Transaction.insertMany(transactions);
        } catch (dbError) {
            console.error("Database error:", dbError);
            // Continue even if DB fails since blockchain operations succeeded
        }

        // Successful response
        const response = { 
            message: "Token transfer completed successfully",
            transferStatus: "SUCCESS",
            transactionId: transferReceipt.transactionId,
            contractId: contractHandler.contractId.toString()
        };

        if (contractReceipt) {
            response.contractStatus = contractReceipt.status.toString();
        } else {
            response.contractStatus = "NOT_RECORDED";
            response.warning = "Tokens were transferred but contract recording failed";
        }

        console.log(`✅ Transfer successful to ${receivers.length} recipient(s)`);
        return res.json(response);

    } catch (error) {
        console.error("Unexpected error in transfer:", error);
        return res.status(500).json({ 
            error: "Internal server error",
            details: error.message 
        });
    }
});



// 📌 Get Smart Contract Transaction History
app.get("/contractTransactions", async (req, res) => {
    try {
        const history = await contractHandler.getTransactionHistory();
        res.json({ transactions: history });
    } catch (error) {
        console.error("❌ Error fetching contract transactions:", error);
        res.status(500).json({ error: error.message });
    }
});

// 📌 Get Contract ID
app.get("/contractInfo", async (req, res) => {
    try {
        res.json({ 
            contractId: contractHandler.contractId.toString(),
            tokenId: tokenId
        });
    } catch (error) {
        console.error("❌ Error fetching contract info:", error);
        res.status(500).json({ error: error.message });
    }
});

// 📌 Fetch all transactions (database + contract)
app.get("/fetchTransactions/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        // Get database transactions
        const dbTransactions = await Transaction.find({
            $or: [{ senderId: userId }, { receiverId: userId }]
        });

        // Get contract transactions
        const contractTransactions = await contractHandler.getTransactionHistory();
        const userContractTransactions = contractTransactions.filter(tx => 
            tx.buyer === userId
        );

        // Format database transactions
        const formattedDbTransactions = dbTransactions.map(tx => ({
            date: tx.date,
            amount: tx.amount,
            power: tx.power,
            price: tx.price ,
            type: tx.senderId === userId ? "buy" : "sell",
            source: "database"
        }));

        // Format contract transactions
        const formattedContractTransactions = userContractTransactions.map(tx => ({
            date: new Date(tx.timestamp * 1000),
            amount: tx.totalAmount,
            power: tx.totalAmount * 100,
            price: 1,
            type: "buy",
            source: "contract"
        }));

        // Combine and sort by date
        const allTransactions = [
            ...formattedDbTransactions,
            ...formattedContractTransactions
        ].sort((a, b) => b.date - a.date);

        if (allTransactions.length === 0) {
            return res.status(404).json({ message: "No transactions found for this user" });
        }

        res.json({ transactions: allTransactions });
    } catch (error) {
        console.error("❌ Error fetching transactions:", error);
        res.status(500).json({ error: error.message });
    }
});

// 📌 API to Get Account Balance
app.get("/balance/:accountId", async (req, res) => {
    try {
        const accountId = req.params.accountId;
        const balanceQuery = new AccountBalanceQuery().setAccountId(accountId);
        const balance = await balanceQuery.execute(client);
        const hbarBalance = balance.hbars.toBigNumber();

        // Fetch HBAR → USD
        const hbarResponse = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=hedera-hashgraph&vs_currencies=usd");
        console.log("🔍 HBAR → USD:", hbarResponse.data);

        if (!hbarResponse.data["hedera-hashgraph"] || !hbarResponse.data["hedera-hashgraph"].usd) {
            throw new Error("Could not retrieve HBAR to USD exchange rate.");
        }

        const hbarToUsd = hbarResponse.data["hedera-hashgraph"].usd;

        // Fetch USD → TND
        const tndResponse = await axios.get("https://api.exchangerate-api.com/v4/latest/USD");
        console.log("🔍 USD → TND:", tndResponse.data);

        if (!tndResponse.data.rates || !tndResponse.data.rates.TND) {
            throw new Error("Could not retrieve USD to TND exchange rate.");
        }

        const usdToTnd = tndResponse.data.rates.TND;

        // Convert balance
        const balanceUSD = hbarBalance * hbarToUsd;
        const balanceTND = balanceUSD * usdToTnd;

        res.json({
            balanceHBAR: hbarBalance.toString(),
            balanceUSD: balanceUSD.toFixed(2),
            balanceTND: balanceTND.toFixed(2),
            exchangeRate: {
                hbarToUsd: hbarToUsd,
                usdToTnd: usdToTnd
            }
        });
    } catch (error) {
        console.error("❌ Error fetching balance:", error.message);
        res.status(500).json({ error: error.message });
    }
});

app.listen(5000, () => console.log("🚀 Server running on port 5000"));