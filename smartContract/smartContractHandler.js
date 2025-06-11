const {
    Client,
    AccountId,
    PrivateKey,
    ContractFunctionParameters,
    ContractCreateFlow,
    ContractExecuteTransaction,
    TransactionReceiptQuery,
    ContractCallQuery,
    TokenId,
    TokenAssociateTransaction,
    TransferTransaction,
    Hbar,
} = require("@hashgraph/sdk");
const fs = require("fs");
const solc = require("solc");

class SmartContractHandler {
    constructor(client, operatorId, operatorKey, tokenId) {
        this.client = client;
        this.operatorId = operatorId;
        this.operatorKey = operatorKey;
        this.greenoTokenId = TokenId.fromString(tokenId);
        this.contractId = null;
    }

    async compileContract() {
        console.log("Compiling Solidity contract...");
        const source = fs.readFileSync("./TransactionHandler.sol", "utf8");

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

    async transferTokensToSellers(buyerAccountId, buyerKey, sellers, tokenAmounts) {
        try {
            console.log(`Transferring tokens from buyer ${buyerAccountId} to sellers...`);
            
            const transaction = new TransferTransaction();
            let totalAmount = 0;
            
            for (let amount of tokenAmounts) {
                totalAmount += amount;
            }
            
            transaction.addTokenTransfer(this.greenoTokenId, buyerAccountId, -totalAmount);
            
            for (let i = 0; i < sellers.length; i++) {
                const sellerAccountId = AccountId.fromString(sellers[i]);
                const amount = tokenAmounts[i];
                transaction.addTokenTransfer(this.greenoTokenId, sellerAccountId, amount);
            }
            
            const signedTx = await transaction
                .freezeWith(this.client)
                .sign(buyerKey);
                
            const txResponse = await signedTx.execute(this.client);
            const receipt = await txResponse.getReceipt(this.client);
            
            console.log(`✅ Transfer status: ${receipt.status.toString()}`);
            
            return { status: receipt.status.toString() };
        } catch (error) {
            console.error("Error transferring tokens:", error);
            throw error;
        }
    }

    async purchaseTokens(buyerAccountId, sellerAccountIds, tokenAmounts) {
        try {
            if (!this.contractId) {
                throw new Error("Contract not deployed. Call deployContract() first.");
            }

            const transferResult = await this.transferTokensToSellers(
                buyerAccountId, 
                this.operatorKey, 
                sellerAccountIds, 
                tokenAmounts
            );
            
            if (transferResult.status !== "SUCCESS") {
                throw new Error(`Token transfer failed with status: ${transferResult.status}`);
            }
            
            const buyerAddress = AccountId.fromString(buyerAccountId).toSolidityAddress();
            const sellerAddresses = sellerAccountIds.map(id => {
                return AccountId.fromString(id).toSolidityAddress();
            });
            
            const tx = await new ContractExecuteTransaction()
                .setContractId(this.contractId)
                .setGas(3000000)
                .setFunction(
                    "recordPurchase",
                    new ContractFunctionParameters()
                        .addAddress(buyerAddress)
                        .addAddressArray(sellerAddresses)
                        .addUint256Array(tokenAmounts)
                )
                .execute(this.client);
            
            const receipt = await tx.getReceipt(this.client);

            if (receipt.status.toString() === "SUCCESS") {
                console.log("✅ Token purchase and recording successful!");
                return receipt;
            } else {
                throw new Error(`Transaction failed. Status: ${receipt.status.toString()}`);
            }
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

module.exports = SmartContractHandler;