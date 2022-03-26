// import { config } from 'dotenv';
// config();
import { Client } from 'discord.js';
import pptr from 'puppeteer';
import { createClient } from 'redis';
import cron from 'node-cron';
const { schedule, validate } = cron;

console.log(`Started at ${new Date()}`);

const discord = new Client({ intents: ["GUILDS", "GUILD_MESSAGES"] });

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
redis.on('error', (err) => console.log('Redis Client Error', err));

let currentTask = null;

const help = `!vpln help                      Displays this message
!vpln                           Replies a picture of the current Vertretungsplan
!vpln config
             channel <channel>  Sets the channel to send messages to
             cron <cron>        Sets the cron expression for sending messages (disabled if invalid expression)
             cron               Displays the current cron expression`;

let CHANNEL_ID = await redis.get('channel');
let CRON = await redis.get('cron');

console.log(`Channel: ${CHANNEL_ID}`);
console.log(`Cron:    ${CRON || 'null'}`);
console.log('')

await updateCron();

discord.on('ready', async client => {
    console.log(`Logged in as ${client.user.tag}!`);
}).on('guildCreate', async guild => {
    console.log(`Joined guild ${guild.name}`);
    const channel = guild.channels.cache.find(channel => channel.type === 'GUILD_TEXT' && channel.permissionsFor(guild.me).has('SEND_MESSAGES'))
    channel.send("Thanks for inviting me.\nI'm a bot that will send you a daily Vertretungsplan.\nRemember to set the channel and cron parameters in the config.")
    channel.send(help)
}).on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!(message.content.startsWith('!vpln') || message.content.startsWith('!vplan'))) return;
    const args = message.content.split(/ +/).slice(1);
    if (!args.length) {
        await downloadVertretungsplan().catch(reason => { debug(`Error downloading new vplan: ${reason}. Returning outdated info!`) });
        await message.reply({ files: ['vertretungsplan.png'] })
            .then(() => { console.log(`Replied with vplan to ${message.author.tag}`) })
            .catch(() => { debug(`Error replying to ${message.author.tag}: ${err}`) });
    } else {
        switch (args[0]) {
            case 'help':
                await message.reply(help)
                    .then(() => { console.log(`Replied with help to ${message.author.tag}`) })
                    .catch(() => { debug(`Error replying to ${message.author.tag}: ${err}`) });
                break;
            case 'config':
                switch (args[1]) {
                    case 'channel':
                        CHANNEL_ID = args[2];
                        await redis.set('channel', args[2]);
                        await message.reply(`Channel set to \`${args[2]}\``)
                        console.log(`Channel set to \`${args[2]}\` on command from ${message.author.tag}`)
                        break;
                    case 'cron':
                        if (args.length > 2) {
                            CRON = args.slice(2).join(' ');
                            await redis.set('cron', CRON);
                            await updateCron();
                            await message.reply(`Cron expression set to \`${CRON}\``)
                            console.log(`Cron expression set to \`${CRON}\` on command from ${message.author.tag}`)
                        } else {
                            await message.reply(`Cron expression is currently set to \`${CRON || 'null'}\``)
                            console.log(`${message.author.tag} viewed cron expression`)
                        }
                        break;
                }
                break;
        }
    }
});

async function downloadVertretungsplan() {
    // Launch headless Chrome.
    const browser = await pptr.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('https://emagyha.eltern-portal.org/service/vertretungsplan');
    // login
    await page.type('#inputEmail', process.env.USER_EMAIL);
    await page.type('#inputPassword', process.env.USER_PWD);

    await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
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
    await browser.close();
}

async function updateCron() {
    if (currentTask) {
        currentTask.stop();
        currentTask = null;
    }
    if (CRON) {
        if (validate(CRON)) {
            currentTask = schedule(CRON, periodicVplanUpdate);
        } else {
            await redis.set('cron', null);
            debug(`Error setting cron to '${CRON}': Invalid expression!`);
            CRON = null;
        }
    }
}

async function periodicVplanUpdate(time) {
    console.log(`periodicVplanUpdate at ${time}`)
    if (CHANNEL_ID) {
        await downloadVertretungsplan().catch(reason => { debug(reason) });
        await discord.channels.fetch(CHANNEL_ID).then(async channel => {
            // Send a local file
            await channel.send({ files: ['./vertretungsplan.png'] })
                .catch(reason => { debug(`Error sending vplan to ${CHANNEL_ID}: ${reason}`) });
        }).catch(reason => { debug(`Couldn't fetch channel ${CHANNEL_ID}: ${reason}`) });
    }
}

function debug(msg) {
    try {
        discord.channels.fetch(CHANNEL_ID).then(async channel => {
            await channel.send(`debug: ${msg}`)
        })
    } finally {
        console.log(`debug: ${msg}`)
    }
}
discord.login(process.env.DISCORD_TOKEN);
