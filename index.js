require('dotenv').config();

const puppeteer = require('puppeteer');
const discord = require('discord.js');

// download image
(async () => {
    const ts = Date.now();
    // Launch headless Chrome.
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('https://emagyha.eltern-portal.org/service/vertretungsplan');
    // login
    await page.type('#inputEmail', process.env.USER_EMAIL, { delay: 50 });
    await page.type('#inputPassword', process.env.USER_PWD, { delay: 50 });
    await Promise.all([
        page.waitForNavigation(),
        page.click('body > div.container > form > button'), // Clicking the link will indirectly cause a navigation
    ]);
    // switch to child
    await page.evaluate(async (sid) => {
        await fetch(`origin/set_child.php?id=${sid}`, {
            method: "POST",
        });
    }, process.env.CHILD_SID);
    await page.goto('https://emagyha.eltern-portal.org/service/vertretungsplan');
    // screenshot
    const table = await page.$('#asam_content > div.main_center');
    await table.screenshot({ path: 'vertretungsplan.png' });
    console.log(`Downloaded latest vertretungsplan in ${(Date.now() - ts) / 1000} seconds`);
    await browser.close();

    const client = new discord.Client({ intents: ['GUILD_MESSAGES', 'GUILD_MESSAGE_TYPING', 'GUILD_SCHEDULED_EVENTS'] });

    client.on('ready', async () => {
        console.log(`Logged in as ${client.user.tag}!`);
        await client.channels.fetch(process.env.CHANNEL_ID).then(async (channel) => {
            // Send a local file
            await channel.send({files: ['./vertretungsplan.png']})
            .catch(console.error);
        });
        client.destroy();
    });

    await client.login(process.env.DISCORD_TOKEN);
})();
