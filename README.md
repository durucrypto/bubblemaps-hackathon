# 🧠 Bubblemaps Telegram Bot

This Telegram bot allows users to input the **contract address** of any token supported by [Bubblemaps](https://www.bubblemaps.io) and provides the following in a structured, easy-to-read format:

1. **Bubble Map Screenshot:**
   Generates and returns a screenshot of the token's bubble map, providing a visual representation of the supply distribution.

2. **Token Information:**
   Gives relevant information for the token such as market cap, price, volume.

3. **Decentralization Metrics:**
   Displays metrics like the decentralization score and the percentage of supply held by centralized exchanges (CEXs).

4. **Additional Insights:**
   Provides additional insights including the distribution of top wallets, supply clusters, and social links.

## Additional Features

- The bot greets users with a welcome message and provides a link to the how-to-use guide (see below).
- Some UI elements are removed for a cleaner bubble map screenshot, while keeping the Bubblemaps logo on it.
- Rate limiting is implemented to restrict the number of requests a user can make within a specified time window.

## How-To-Use Guide:
- Send a private message to the bot on Telegram by clicking [here](https://t.me/Bubblemaps_Hackathon_Bot).
- Post the token you want to get information for. This can be in one of the following formats:
   - Bubblemaps link
   - Dexscreener link
   - Contract address of the token or the pool
   - Name of the token

- The bot will gather data for the requested token and respond within a few seconds.

## APIs Utilized

- **Bubblemaps API**: To check if the bubble map is available and fetch the token's bubble map, map data, and metadata.
- **Dexscreener API**: To retrieve key token information such as market data and DEX-related insights.
- **Coingecko API**: To obtain the token's Coingecko ID along with links and social profiles.

## ⚙️ Setup Instructions

1. Clone the repository:

    ```bash
    git clone https://github.com/durucrypto/bubblemaps-hackathon.git
    ```

2. Change the directory:

    ```bash
    cd bubblemaps-hackathon
    ```

3. Install dependencies:

    ```bash
    npm install
    ```

4. Create your `.env` file:

    ```bash
    cp sample.env .env
    ```

    Then open `.env` and add your config values.

5. Start the bot:

    ```bash
    npm start
    ```

    Or, if you prefer:

    ```bash
    node bubblemapsBot.js
    ```
