
Blockchain - Hedera Hashgraph Energy Trading Platform
========================================================

![Hedera](https://img.shields.io/badge/Hedera-Hashgraph-%252300a8e0?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-18.x-%2523339933?style=for-the-badge)
![Express](https://img.shields.io/badge/Express-4.x-%2523000000?style=for-the-badge)

Blockchain server implementation for GreenEnergy Chain project, enabling peer-to-peer electricity trading using Hedera Hashgraph and the Greeno cryptocurrency.

✨ Key Features
---------------
⚡️ Real-time Electricity Trading: Peer-to-peer energy transactions between producers and consumers

💰 Greeno Cryptocurrency: Custom token implementation for energy transactions

🤝 Smart Contracts: Automated energy trading with balance and availability verification

🌳 Carbon Credit Integration: Track environmental impact of transactions

🔒 Hedera Hashgraph: Enterprise-grade distributed ledger technology for secure transactions

📊 Contribution-based Rewards: Fair compensation based on energy contribution

📦 System Architecture
----------------------
Diagram
Code

🚀 Getting Started
------------------
Prerequisites
- Node.js v18+
- Hedera Hashgraph account
- Hedera Testnet access
- npm v9+

Installation
------------
```bash
# Clone the repository
git clone https://github.com/your-org/Blockchain_PIM.git

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Fill in your Hedera credentials in .env
HEDERA_ACCOUNT_ID=0.0.xxxx
HEDERA_PRIVATE_KEY=xxxxx
HEDERA_NETWORK=testnet
TOKEN_ID=0.0.xxxx  # Your Greeno token ID
```

Running the Server
------------------
```bash
# Start in development mode
npm run dev

# Start in production mode
npm start
```

🌿 Greeno Token System
----------------------
Our custom cryptocurrency parameters:

| Parameter       | Value                |
|-----------------|----------------------|
| Token Name      | Greeno               |
| Symbol          | GRN                  |
| Initial Supply  | 1,000,000 GRN       |
| Decimal Places  | 8                    |
| Token Type      | Fungible (HTS)       |
| Treasury Account| Project Admin        |


🤝 Contributing
---------------
We welcome contributions! Please see our Contribution Guidelines for more information.

📬 Contact
----------
Project Maintainer - Yassine Ajbouni
Email - yassineajbouni.y@gmail.com
Hedera Forum - Project Discussion Thread
