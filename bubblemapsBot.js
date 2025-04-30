require("dotenv").config();

const fs = require("fs");
const path = require("path");

const axios = require("axios");
const dayjs = require("dayjs");
const puppeteer = require("puppeteer-extra");
const stealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(stealth());

const { Telegraf } = require("telegraf");
const telegramBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const telegramBotUsername = process.env.TELEGRAM_BOT_USERNAME;

const welcomeMsg = "Welcome to the Bubblemaps Bot! You can use the /help command to view the instructions on how to use the bot."; // default welcome message for the bot
const guideUrl = "https://github.com/durucrypto/bubblemaps-hackathon?tab=readme-ov-file#-how-to-use-guide";

const userRequests = new Map(); // map to track user requests for rate-limiting
const maxRequestLimit = 5; // maximum number of allowed requests per user within a time window
const timeWindow = 10 * 1000; // (in ms), set to 10 seconds in this case

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"; // useful for headers when making HTTP requests

// CSS selectors for elements to hide on Bubblemaps' page
const elementsToHide = [
    "header.mdc-top-app-bar.mdc-top-app-bar--fixed",
    "footer",
    ".sidebar",
    "#app > div > div > div.fundraising-banner.--desktop",
    "#app > div > div > div.fundraising-banner.--mobile",
    "#zoom_in",
    "#zoom_out",
    "#app > div > div > div.graph-view > div:nth-child(6) > div.buttons-row__left-side",
    "#app > div > div > div.graph-view > div:nth-child(6) > div.buttons-row__right-side",
];

const screenshotsDir = path.join(__dirname, "screenshots");

/******************************************************************************************/

// format large numbers into a readable string with units
function formatBigNumber(num) {
    if (num) {
        if (num >= 1e12) { return `$${(num / 1e12).toFixed(1)}T`; } // Convert to trillions
        else if (num >= 1e9) { return `$${(num / 1e9).toFixed(1)}B`; } // Convert to billions
        else if (num >= 1e6) { return `$${(num / 1e6).toFixed(1)}M`; } // Convert to millions
        else if (num >= 1e3 || num >= 1e2) { return `$${(num / 1e3).toFixed(1)}K`; } // Convert to thousands
        else { return `$${num}`; }
    }

    return "";
}

// format number with a sign (+ or -)
function formatSign(num) {
    if (num) {
        if (num.startsWith("-")) {
            return `(${num})`;
        }

        return `(+${num})`;
    }

    return "";
}

// format percentage to one decimal place
function formatPct(num) {
    if (num) {
        return `${num.toFixed(1)}%`;
    }

    return "";
}

// calculate the time difference between a given timestamp and the current time
function calculateTimeDiff(now, pastTimestamp) {
    if (pastTimestamp) {
        const past = dayjs(pastTimestamp * 1000);

        const years = now.diff(past, "year");
        const months = now.diff(past, "month") % 12;
        const days = now.diff(past, "day") % 30;
        const hours = now.diff(past, "hour") % 24; 
        const minutes = now.diff(past, "minute") % 60;

        if (years > 0) {
            return `${years}y ${months}mo ago`;

        } else if (months > 0) {
            return `${months}mo ${days}d ago`;

        } else if (days > 0) {
            return `${days}d ${hours}h ago`; 

        } else if (hours > 0) {
            return `${hours}h ${minutes}m ago`;

        } else {
            return `${minutes}m ago`; 
        }
    }

    return "";
}

// format and return a structured message based on the provided token information
function formatMsg(tokenObj) {
    let formattedMsg = "";
    const now = dayjs();

    if (tokenObj.name && tokenObj.ticker) {
        formattedMsg += `<b>${tokenObj.name} (${tokenObj.ticker})</b> `;
    }

    formattedMsg += `<a href="https://t.me/${telegramBotUsername}?start=scan_${tokenObj.chain_id}_${tokenObj.token_address}">🔄 Refresh</a>\n|\n`;
    formattedMsg += `├ <code>${tokenObj.token_address}</code>\n`;
    formattedMsg += `└ #${tokenObj.chain_id} | ${calculateTimeDiff(now, tokenObj.lp_launch_date)}\n\n`;

    const links = [
        tokenObj.website_url ? `<a href="${tokenObj.website_url}">🌐 Website</a>` : "",
        tokenObj.twitter_url ? `<a href="${tokenObj.twitter_url}">🐦 X</a>` : "",
        tokenObj.telegram_url ? `<a href="${tokenObj.telegram_url}">📢 TG</a>` : "",
        `<a href="https://x.com/search?q=${tokenObj.token_address}&src=typed_query&f=live">🔎 Search on X</a>`
    ].filter(Boolean).join(" | ");
    
    formattedMsg += links;

    if (tokenObj.wallet_pct_first_group) {
        formattedMsg += `\n\n<b>🎯 Top Wallets Supply Pct</b>`;
        formattedMsg += `\n  ├ <code>Top ${tokenObj.size_first_group}:</code>  ${formatPct(tokenObj.wallet_pct_first_group)}`;
        if (tokenObj.wallet_pct_first_group !== tokenObj.holder_pct_first_group) {
            formattedMsg += `\n  ├ <code>Top ${tokenObj.size_first_group}(exc contracts):</code>  ${formatPct(tokenObj.holder_pct_first_group)}`;
        }

        formattedMsg += `\n  ├ <code>Top ${tokenObj.size_second_group}:</code>  ${formatPct(tokenObj.wallet_pct_second_group)}`;
        if (tokenObj.wallet_pct_second_group !== tokenObj.holder_pct_second_group) {
            formattedMsg += `\n  ├ <code>Top ${tokenObj.size_second_group}(exc contracts):</code>  ${formatPct(tokenObj.holder_pct_second_group)}`;
        }

        formattedMsg += `\n  ├ <code>Top ${tokenObj.size_third_group}:</code>  ${formatPct(tokenObj.wallet_pct_third_group)}`;
        if (tokenObj.wallet_pct_third_group !== tokenObj.holder_pct_third_group) {
            formattedMsg += `\n  ├ <code>Top ${tokenObj.size_third_group}(exc contracts):</code>  ${formatPct(tokenObj.holder_pct_third_group)}`;
        }

        formattedMsg = formattedMsg.replace(/├(?![\s\S]*├)/, "└");
    }

    if (tokenObj.decentralisation_score || tokenObj.cex_supply_pct || tokenObj.contracts_supply_pct) {
        formattedMsg += `\n\n<b>📋 Metadata</b>`;
        formattedMsg += `\n  ├ <code>Decentralisation Score:</code>  ${tokenObj.decentralisation_score ? tokenObj.decentralisation_score : ""}`;
        formattedMsg += `\n  ├ <code>CEX Supply:</code>  ${formatPct(tokenObj.cex_supply_pct)}`;
        formattedMsg += `\n  └ <code>Contracts Supply:</code>  ${formatPct(tokenObj.contracts_supply_pct)}`;
    }

    if (tokenObj.top_clusters && tokenObj.top_clusters.length > 0 && tokenObj.circ_supply) {
        formattedMsg += `\n\n<b>📊 Top Clusters Supply Pct</b>`;
        tokenObj.top_clusters.forEach((cluster, index) => {
            formattedMsg += `\n  ├ <code>Cluster ${index + 1}:</code> ${formatPct(100 * cluster.totalAmount / tokenObj.circ_supply)}`;
        });
    }

    if (tokenObj.bm_map_data_timestamp) {
        if (formattedMsg.includes("<b>📋 Metadata</b>") || formattedMsg.includes("<b>📊 Top Clusters Supply Pct</b>")) {
            formattedMsg += `\n  └ <code>Last Update:</code>  ${calculateTimeDiff(now, tokenObj.bm_map_data_timestamp)}`;
        }
    }

    if (tokenObj.price || tokenObj.market_cap) {
        formattedMsg += `<b>\n\n📊 Token Stats</b>`;
        formattedMsg += `\n  ├ <code>Price:</code>  ${tokenObj.price ? `$${tokenObj.price} ${formatSign(formatPct(tokenObj.daily_price_chg_pct))}` : ""}`;
        formattedMsg += `\n  ├ <code>MC:</code>  ${formatBigNumber(tokenObj.market_cap)}`;
        formattedMsg += `\n  ├ <code>24h Dex Vol:</code>  ${formatBigNumber(tokenObj.daily_dex_vol)}`;
        formattedMsg += `\n  ├ <code>Dex Liq:</code>  ${formatBigNumber(tokenObj.total_dex_liq)}`;
        formattedMsg += `\n  ├ <code>24h Dex Tx Count:</code>  ${tokenObj.daily_dex_txs ? tokenObj.daily_dex_txs.toLocaleString() : ""}`;
        formattedMsg += `\n  └ <code>LP Add Date:</code>  ${tokenObj.lp_launch_date ? dayjs.unix(tokenObj.lp_launch_date).format("MM/DD/YYYY") : ""}`;
    }

    const extraLinks = [
        `<a href="https://app.bubblemaps.io/${tokenObj.chain_id}/token/${tokenObj.token_address}">🗺️ Bubblemaps</a>`,
        tokenObj.ds_url ? `<a href="${tokenObj.ds_url}">🦅 DS</a>` : "",
        tokenObj.cg_url ? `<a href="${tokenObj.cg_url}">🦎 CG</a>` : ""
    ].filter(Boolean).join(" | ");

    formattedMsg += "\n\n" + extraLinks;

    return formattedMsg;
}

async function editBotResponse(ctx, botResponse, tokenObj) {
    try {
        const formattedMsg = formatMsg(tokenObj); // format the message using the token object

        // check if a map path exists (whether a map image should be sent)
        if (tokenObj.map_path) {
            // edit the existing message and update it with a photo and caption
            await ctx.telegram.editMessageMedia(botResponse.chat.id, botResponse.message_id, null, {
                type: "photo",
                media: { source: fs.createReadStream(tokenObj.map_path) },
                caption: formattedMsg,
                parse_mode: "HTML",
                disable_web_page_preview: true,
            });

            fs.unlinkSync(path.normalize(tokenObj.map_path)); // delete the map image file after sending the media

        } else {
            // if no map image path is provided, just update the message text
            await ctx.telegram.editMessageText(botResponse.chat.id, botResponse.message_id, null,
                formattedMsg,
                { parse_mode: "HTML", disable_web_page_preview: true }
            );
        }

    } catch(error) {
        console.error(error);
    }
}

/******************************************************************************************/

// map various chain aliases to Coingecko-compatible chain IDs
function getCgChainId(chainId) {
    if (chainId === "eth" || chainId === "ethereum") { return "ethereum"; }
    else if (chainId === "bsc") { return "binance-smart-chain"; }
    else if (chainId === "ftm" || chainId === "fantom") { return "fantom"; }
    else if (chainId === "avax" || chainId === "avalanche") { return "avalanche"; }
    else if (chainId === "cro" || chainId === "cronos") { return "cronos"; }
    else if (chainId === "arb" || chainId === "arbi" || chainId === "arbitrum") { return "arbitrum-one"; }
    else if (chainId === "pol" || chainId === "poly" || chainId === "polygon") { return "polygon-pos"; }
    else if (chainId === "base") { return "base"; }
    else if (chainId === "sol" || chainId === "solana") { return "solana"; }
    else if (chainId === "sonic") { return "sonic"; }
}

// fetch token's data from Coingecko
async function getCgData(chainId, tokenAddress) { 
    try {
        const cgChainId = getCgChainId(chainId);

        const cgDataResponse = await axios.get(`https://api.coingecko.com/api/v3/coins/${cgChainId}/contract/${tokenAddress}`);
        const cgData = cgDataResponse.data;

        // construct URLs from Coingecko's data 
        const coingeckoUrl = `https://coingecko.com/en/coins/${cgData.id}`;
        const websiteUrl = cgData.links.homepage.length > 0 ? cgData.links.homepage[0] : null;
        const twitterUrl = cgData.links.twitter_screen_name ? `https://x.com/${cgData.links.twitter_screen_name}` : null;
        const telegramUrl = cgData.links.telegram_channel_identifier ? `https://t.me/${cgData.links.telegram_channel_identifier}` : null;

        return {
            cg_url: coingeckoUrl,
            website_url: websiteUrl,
            twitter_url: twitterUrl,
            telegram_url: telegramUrl,
        }

    } catch(error) {
        console.error("Coin not found on Coingecko.");
    }
}

/******************************************************************************************/

// map various chain aliases to Dexscreener-compatible chain IDs
function getDsChainId(chainId) {
    if (chainId === "eth" || chainId === "ethereum") { return "ethereum"; }
    else if (chainId === "bsc") { return "bsc"; }
    else if (chainId === "ftm" || chainId === "fantom") { return "fantom"; }
    else if (chainId === "avax" || chainId === "avalanche") { return "avalanche"; }
    else if (chainId === "cro" || chainId === "cronos") { return "cronos"; }
    else if (chainId === "arb" || chainId === "arbi" || chainId === "arbitrum") { return "arbitrum"; }
    else if (chainId === "pol" || chainId === "poly" || chainId === "polygon") { return "polygon"; }
    else if (chainId === "base") { return "base"; }
    else if (chainId === "sol" || chainId === "solana") { return "solana"; }
    else if (chainId === "sonic") { return "sonic"; }
}

// fetch token's data from Dexscreener
async function getDsData(chainId, tokenAddress) {
    try {
        const dsDataResponse = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${tokenAddress}`);
        const dsData = dsDataResponse.data.pairs;

        let name;
        let ticker;
        let lpLaunchDate;

        let dsUrl;
        let websiteUrl;
        let twitterUrl;
        let telegramUrl;

        let price = null;
        let marketCap = null;
        let dailyPriceChgPct = null;
        let totalDexLiq = null;
        let dailyDexVol = null;
        let dailyDexTxs = null;

        const dsChainId = getDsChainId(chainId);

        for (let i = 0; i < dsData.length; i++) { // iterate over the pairs
            if (dsData[i].chainId === dsChainId) {

                if (!name && dsData[i].baseToken) { name = dsData[i].baseToken.name; }
                if (!ticker && dsData[i].baseToken) { ticker = dsData[i].baseToken.symbol; }
                if ((!lpLaunchDate && dsData[i].pairCreatedAt) || (dsData[i].pairCreatedAt && dsData[i].pairCreatedAt < lpLaunchDate)) { lpLaunchDate = dsData[i].pairCreatedAt; }

                if (!dsUrl && dsData[i].url) { dsUrl = dsData[i].url; }

                if (!websiteUrl && dsData[i].info && dsData[i].info.websites) {
                    for (let j = 0; j < dsData[i].info.websites.length; j++) {
                        if (!websiteUrl && dsData[i].info.websites[j].label.toLowerCase() === "website") { websiteUrl = dsData[i].info.websites[j].url; }
                    }
                }

                if ((!twitterUrl || !telegramUrl) && dsData[i].info && dsData[i].info.socials) {
                    for (let j = 0; j < dsData[i].info.socials.length; j++) {
                        if (!twitterUrl && dsData[i].info.socials[j].type.toLowerCase() === "twitter") { twitterUrl = dsData[i].info.socials[j].url; }
                        if (!telegramUrl && dsData[i].info.socials[j].type.toLowerCase() === "telegram") { telegramUrl = dsData[i].info.socials[j].url; }
                    }
                }

                if (!price && dsData[i].priceUsd) { price = Number(dsData[i].priceUsd); }
                if (!marketCap || (dsData[i].marketCap && dsData[i].marketCap > marketCap)) { marketCap = Number(dsData[i].marketCap); }
                if (!dailyPriceChgPct && dsData[i].priceChange) { dailyPriceChgPct = dsData[i].priceChange.h24 || 0; }
                if (dsData[i].liquidity) { totalDexLiq += dsData[i].liquidity.usd || 0; }
                if (dsData[i].volume) { dailyDexVol += dsData[i].volume.h24 || 0; }
                if (dsData[i].txns && dsData[i].txns.h24) { dailyDexTxs += (dsData[i].txns.h24.buys + dsData[i].txns.h24.sells) || 0; }
            }
        }

        return {
            name: name,
            ticker: ticker,
            lp_launch_date: dayjs(lpLaunchDate).unix(),

            ds_url: dsUrl,
            website_url: websiteUrl,
            twitter_url: twitterUrl,
            telegram_url: telegramUrl,

            price: price,
            market_cap: Math.round(marketCap),
            daily_price_chg_pct: dailyPriceChgPct,
            total_dex_liq: Math.round(totalDexLiq),
            daily_dex_vol: Math.round(dailyDexVol),
            daily_dex_txs: dailyDexTxs
        }

    } catch(error) {
        console.error(error);
    }
}

/******************************************************************************************/

// fetch token's map metadata from Bubblemaps
async function getBmMapMetadata(chainId, tokenAddress) {
    try {
        const bmMapMetadataResponse = await  axios.get(`https://api-legacy.bubblemaps.io/map-metadata?chain=${chainId}&token=${tokenAddress}`);
        const bmMapMetadata = bmMapMetadataResponse.data;

        if (bmMapMetadata.status === "OK") { // check if map metadata is available
            return {
                decentralisation_score: bmMapMetadata.decentralisation_score,
                cex_supply_pct: bmMapMetadata.identified_supply.percent_in_cexs,
                contracts_supply_pct: bmMapMetadata.identified_supply.percent_in_contracts,
                bm_map_metadata_timestamp: dayjs(bmMapMetadata.dt_update).unix()
            }
        }

    } catch(error) {
        console.error("Bubblemap metadata not found.");
    }
}

/******************************************************************************************/

// explore clusters of connected addresses using depth-first search
function exploreCluster(startAddress, graph, visited) {
    let stack = [startAddress];
    let cluster = new Set();

    // perform depth-first search to explore clusters
    while (stack.length > 0) {
        let address = stack.pop();
        if (!visited.has(address)) {
            visited.add(address);
            cluster.add(address);
            (graph.get(address) || []).forEach(neighbor => {
                if (!visited.has(neighbor)) stack.push(neighbor);
            });
        }
    }

    return cluster;
}

// add an undirected edge between source and target in the graph (bidirectional links)
function addEdge(graph, source, target) {
    if (!graph.has(source)) graph.set(source, new Set());
    if (!graph.has(target)) graph.set(target, new Set());

    graph.get(source).add(target);
    graph.get(target).add(source);
}

// fetch token's map data from Bubblemaps
async function getBmMapData(chainId, tokenAddress) {
    try {
        const bmMapDataResponse = await axios.get(`https://api-legacy.bubblemaps.io/map-data?token=${tokenAddress}&chain=${chainId}`);
        const bmMapData = bmMapDataResponse.data;

        let circSupply = null;

        const sizeFirstGroup = 10;
        const sizeSecondGroup = 25;
        const sizeThirdGroup = 100;

        // percentages for wallets and holders(wallets excluding contracts) in each group
        let walletPctFirstGroup = 0;
        let walletPctSecondGroup = 0;
        let walletPctThirdGroup = 0;

        let holderPctFirstGroup = 0;
        let holderPctSecondGroup = 0;
        let holderPctThirdGroup = 0;

        const addressGraph = new Map();  // store address graph (links between addresses)
        const visitedAddresses = new Set(); // track visited addresses to avoid revisits
        const addressClusters = []; // store clusters of connected addresses

        // process each node (address) in the map data
        bmMapData.nodes.forEach((node, i) => {
            if (!circSupply && node.amount && node.percentage) {
                circSupply = Math.round(100 * node.amount / node.percentage);
            }

            if (!node.is_contract) {
                // accumulate percentages for holders
                if (i < sizeFirstGroup) holderPctFirstGroup += node.percentage;
                if (i < sizeSecondGroup) holderPctSecondGroup += node.percentage;
                if (i < sizeThirdGroup) holderPctThirdGroup += node.percentage;
            }

            // accumulate percentages for wallets
            if (i < sizeFirstGroup) walletPctFirstGroup += node.percentage;
            if (i < sizeSecondGroup) walletPctSecondGroup += node.percentage;
            if (i < sizeThirdGroup) walletPctThirdGroup += node.percentage;
        });

        // process links for the address graph
        bmMapData.links.forEach(link => {
            const sourceNode = bmMapData.nodes[link.source];
            const targetNode = bmMapData.nodes[link.target];
            if (sourceNode && targetNode && !sourceNode.is_contract && !targetNode.is_contract) {
                addEdge(addressGraph, sourceNode.address, targetNode.address);
            }
        });

        // process token links for the address graph
        bmMapData.token_links.forEach(tokenLink => {
            tokenLink.links.forEach(link => {
                const sourceNode = bmMapData.nodes[link.source];
                const targetNode = bmMapData.nodes[link.target];
                if (sourceNode && targetNode && !sourceNode.is_contract && !targetNode.is_contract) {
                    addEdge(addressGraph, sourceNode.address, targetNode.address);
                }
            });
        });

        // explore clusters of connected addresses
        bmMapData.nodes.forEach((node) => {
            if (!node.is_contract && !visitedAddresses.has(node.address)) {
                const cluster = exploreCluster(node.address, addressGraph, visitedAddresses);
                if (cluster.size > 1) addressClusters.push(cluster); // add cluster if more than one address is present
            }
        });

        // calculate the total amount of tokens in each cluster
        const clusterAmounts = addressClusters.map(cluster => {
            const totalAmount = [...cluster].reduce((sum, address) => {
                const node = bmMapData.nodes.find(node => node.address === address);
                return sum + (node ? node.amount : 0);
            }, 0);

            return totalAmount > 0 ? { addresses: [...cluster], totalAmount } : null;

        }).filter(Boolean);

        const clusterSize = 5;
        const topClusters = clusterAmounts.sort((a, b) => b.totalAmount - a.totalAmount).slice(0, clusterSize); // sort clusters by total amount and get the top ones

        return {
            circ_supply: circSupply,

            size_first_group: sizeFirstGroup,
            size_second_group: sizeSecondGroup,
            size_third_group: sizeThirdGroup,

            wallet_pct_first_group: walletPctFirstGroup,
            wallet_pct_second_group: walletPctSecondGroup,
            wallet_pct_third_group: walletPctThirdGroup,

            holder_pct_first_group: holderPctFirstGroup,
            holder_pct_second_group: holderPctSecondGroup,
            holder_pct_third_group: holderPctThirdGroup,

            top_clusters: topClusters,
            bm_map_data_timestamp: dayjs(bmMapData.dt_update).unix()
        };

    } catch(error) {
        console.error(error);
    }
}

/******************************************************************************************/

// capture a screenshot of token's bubblemap
async function captureBubblemap(chainId, tokenAddress) {
    let browserInstance;

    try {
        // launch Puppeteer browser instance
        browserInstance = await puppeteer.launch({
            headless: true,
            args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-popup-blocking",
            ]
        });

        const page = await browserInstance.newPage();
        await page.setUserAgent(userAgent);

        // set viewport size
        await page.setViewport({
            width: 1280,
            height: 800
        });

        // navigate to Bubblemaps URL for token
        await page.goto(`https://app.bubblemaps.io/${chainId}/token/${tokenAddress}`, {
            waitUntil: "load",
            timeout: 0
        });

        // wait for header to load, indicating page is ready
        await page.waitForSelector("header.mdc-top-app-bar", { visible: true }); // Wait for the header to load

        // wait for all elements to be visible before hiding them
        await Promise.all(
            elementsToHide.map(selector =>
                page.waitForSelector(selector, { visible: true, timeout: 3000 }).catch(() => {})
            )
        );

        // inject CSS to hide unwanted elements on the page
        await page.evaluate((elementsToHide) => {
            elementsToHide.forEach((selector) => {
                const targetElement = document.querySelector(selector);

                if (targetElement) {
                    targetElement.style.setProperty("display", "none", "important");
                }
            });
        }, elementsToHide);

        // capture screenshot of the page
        const now = Date.now();

        // check if the folder exists, and create it if not
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        const screenshotPath = path.join(screenshotsDir, `screenshot_${chainId}_${tokenAddress}_${now}.png`);

        await page.screenshot({
            path: screenshotPath,
            fullPage: true,
        });

        return screenshotPath;

    } catch(error) {
        console.error("Error while capturing the bubblemap screenshot:", error);

    } finally {
        if (browserInstance) {
            await browserInstance.close(); // close the browser instance after capture
        }
    }
}

// fetch token's bubblemap path
async function getBmPath(chainId, tokenAddress) {
    try {
        const isBubblemapAvail = await axios.get(`https://api-legacy.bubblemaps.io/map-availability?chain=${chainId}&token=${tokenAddress}`);

        if (isBubblemapAvail.data.status === "OK") { // check if bubblemap is available
            const bubblemapPath = await captureBubblemap(chainId, tokenAddress);
            return bubblemapPath;
        }

    } catch(error) {
        console.error(error);
    }
}

/******************************************************************************************/

// fetch token details and post them to the bot's response
async function postTokenDetails(ctx, botResponse, chainId, tokenAddress) {
    try {
        const [bmPath, bmMapDataObj, bmMapMetadataObj, dsDataObj, cgDataObj] = await Promise.all([
            getBmPath(chainId, tokenAddress) || {}, // Bubblemaps data (first 3)
            getBmMapData(chainId, tokenAddress) || {},
            getBmMapMetadata(chainId, tokenAddress) || {},
            getDsData(chainId, tokenAddress) || {}, // Dexscreener data
            getCgData(chainId, tokenAddress) || {} // Coingecko data
        ]);

        // aggregate token data into a single object
        const tokenObj = {
            ...bmMapDataObj,
            ...bmMapMetadataObj,
            ...dsDataObj,
            map_path: bmPath,
            chain_id: chainId,
            token_address: tokenAddress
        };

        const urlFields = ["cg_url", "website_url", "twitter_url", "telegram_url"]; // fields to check for missing URLs

        // override missing URLs if available in Coingecko data
        for (const field of urlFields) {
            if (!tokenObj[field] && cgDataObj[field]) {
                tokenObj[field] = cgDataObj[field];
            }
        }

        // override market cap with Bubblemaps' data if the circulating supply can be calculated
        // (except for Solana tokens where the decimals field is needed but not available in the API)
        if (tokenObj.circ_supply && tokenObj.price) {
            if (chainId !== "sol") {
                tokenObj.market_cap = Math.round(tokenObj.circ_supply * tokenObj.price);
            }
        }

        await editBotResponse(ctx, botResponse, tokenObj); // send the aggregated token data to the bot's response

    } catch(error) {
        console.error(error);
    }
}

/******************************************************************************************/

// map various chain aliases to Bubblemaps-compatible chain IDs
function getBmChainId(chainId) {
    if (chainId === "eth" || chainId === "ethereum") { return "eth"; }
    else if (chainId === "bsc") { return "bsc"; }
    else if (chainId === "ftm" || chainId === "fantom") { return "ftm"; }
    else if (chainId === "avax" || chainId === "avalanche") { return "avax"; }
    else if (chainId === "cro" || chainId === "cronos") { return "cro"; }
    else if (chainId === "arb" || chainId === "arbi" || chainId === "arbitrum") { return "arbi"; }
    else if (chainId === "pol" || chainId === "poly" || chainId === "polygon") { return "poly"; }
    else if (chainId === "base") { return "base"; }
    else if (chainId === "sol" || chainId === "solana") { return "sol"; }
    else if (chainId === "sonic") { return "sonic"; }
}

// validate token address using the provided regex
function validateAddress(tokenAddress, regex) {
    return regex.test(tokenAddress);
}

// add https:// prefix if missing
function normalizeUrl(url) {
    if (!/^https?:\/\//i.test(url)) {
        return "https://" + url;
    }

    return url;
}

// return pathname parts from a given URL
function parseUrlPathParts(url) {
    try {
        const normalizedUrl = normalizeUrl(url);
        const parsedUrl = new URL(normalizedUrl);
        const urlPathParts = parsedUrl.pathname.split("/").filter(Boolean);

        return urlPathParts;

    } catch(error) {
        console.error(error);
    }
}

// parse user input to extract chain ID and token address
async function parseUserMsg(msg) {
    try {
        let chainId;
        let tokenAddress;

        if (msg.includes("app.bubblemaps.io")) { // handle Bubblemaps links
            const urlPathParts = parseUrlPathParts(msg) || [];

            if (urlPathParts.length === 3 && getBmChainId(urlPathParts[0])) {
                chainId = getBmChainId(urlPathParts[0]);
                const regex = chainId !== "sol" ? /^0x[a-fA-F0-9]{40}$/ : /^[1-9A-HJ-NP-Za-km-z]{44}$/;

                if (validateAddress(urlPathParts[2], regex)) {
                    tokenAddress = urlPathParts[2];
                }
            }

        } else if (msg.includes("dexscreener.com")) { // handle Dexscreener links
            const urlPathParts = parseUrlPathParts(msg);

            if (urlPathParts.length === 2 && getBmChainId(urlPathParts[0])) {
                chainId = getBmChainId(urlPathParts[0]);
                const regex = chainId !== "sol" ? /^0x[a-fA-F0-9]{40}$/ : /^[1-9A-HJ-NP-Za-km-z]{44}$/;

                if (validateAddress(urlPathParts[1], regex)) {
                    const dsResponse = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${urlPathParts[1]}`);

                    for (const pair of dsResponse.data.pairs) {
                        if (pair.chainId === urlPathParts[0]) {
                            tokenAddress = pair.baseToken.address;
                            break;
                        }
                    }
                }
            }

        } else { // handle plain token address or name
            const dsResponse = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${msg}`);

            for (const pair of dsResponse.data.pairs) {
                if (getBmChainId(pair.chainId)) {
                    chainId = getBmChainId(pair.chainId);
                    tokenAddress = pair.baseToken.address;
                    break;
                }
            }
        }

        return [chainId, tokenAddress];

    } catch(error) {
        console.error(error);
    }
}

/******************************************************************************************/

// return true if user exceeded request limit within time window
function isUserRateLimited(userId) {
    const now = Date.now();

    if (!userRequests.has(userId)) {
        userRequests.set(userId, []);
    }

    const userTimestamps = userRequests.get(userId);

    while (userTimestamps.length > 0 && userTimestamps[0] < now - timeWindow) {
        userTimestamps.shift(); // remove timestamps outside the current time window
    }

    userTimestamps.push(now);

    return userTimestamps.length > maxRequestLimit; // rate limit if number of requests exceeds max
}

/******************************************************************************************/

// launch Telegram bot and set up handlers
async function main() {
    try {
        telegramBot.launch(); // start polling
        console.log("Launched the bot.");

        // handle /start command
        telegramBot.start(async (ctx) => {
            try {
                if (ctx.chat.type !== "private") { return; } // ignore non-private messages

                const startParam = ctx.startPayload;

                if (!startParam) {
                    ctx.reply(welcomeMsg); // send default welcome message

                } else if (startParam.startsWith("scan_")) { // handle refresh action
                    if (!isUserRateLimited(ctx.from.id)) {
                        const startParamParts = startParam.split("_");

                        const userMsg = `https://app.bubblemaps.io/${startParamParts[1]}/token/${startParamParts[2]}`;
                        const [chainId, tokenAddress] = await parseUserMsg(userMsg) || [];

                        const botResponse = await ctx.reply("⏳ Fetching token details...");

                        if (chainId && tokenAddress) {
                            postTokenDetails(ctx, botResponse, chainId, tokenAddress); // fetch token details and update the response

                        } else { // handle invalid token or link
                            ctx.telegram.editMessageText(botResponse.chat.id, botResponse.message_id, null, "Couldn't find the token. Please make sure the link/token address is correct and the input format is valid.");
                        }
                    }
                }

            } catch(error) {
                console.error(error);
            }
        });

        // handle text messages
        telegramBot.on("text", async (ctx) => {
            try {
                if (ctx.message.chat.type !== "private" || ctx.message.from.is_bot) { return; } // ignore non-private messages or messages from bots

                if (!isUserRateLimited(ctx.from.id)) {
                    const userMsg = ctx.message.text.trim().replace(/\s+/g, " ");

                    if (userMsg.toLowerCase() === "/help" || userMsg.toLowerCase() === "/guide") {
                        ctx.reply(`📘 To view the how-to-use guide, [click here](${guideUrl}).`, { parse_mode: "Markdown", disable_web_page_preview: true });
                        return;
                    }

                    const [chainId, tokenAddress] = await parseUserMsg(userMsg) || [];

                    const botResponse = await ctx.reply("⏳ Fetching token details...");

                    if (chainId && tokenAddress) {
                        postTokenDetails(ctx, botResponse, chainId, tokenAddress);  // fetch token details and update the response

                    } else { // handle invalid token or link
                        ctx.telegram.editMessageText(botResponse.chat.id, botResponse.message_id, null, "Couldn't find the token. Please make sure the link/token address is correct and the input format is valid.");
                    }
                }

            } catch(error) {
                console.error(error);
            }
        });

    } catch(error) {
        console.error(error);
    }
}

main();
