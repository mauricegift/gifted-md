const { gmd } = require("../gift"),
        acrcloud = require("acrcloud"),
        fs = require("fs").promises,
        axios = require('axios'),
        stream = require("stream"),
        { promisify } = require("util"),
        pipeline = promisify(stream.pipeline),
        { generateWAMessageContent, generateWAMessageFromContent } = require('gifted-baileys');


gmd({
    pattern: "yts",
    aliases: ["yt-search"],
    category: "search",
    react: "🔍",
    description: "perform youtube search"
  },
  async (from, Gifted, conText) => {
    const { q, mek, reply, react, sender, botFooter, gmdBuffer } = conText;

    if (!q) {
      await react("❌");
      return reply("Please provide a search query");
    }

    try {
      const apiUrl = `https://yts.giftedtech.co.ke/?q=${encodeURIComponent(q)}`;
    const res = await axios.get(apiUrl, { timeout: 100000 });
    const results = res.data?.videos;

    if (!Array.isArray(results) || results.length === 0) return;

    const videos = results.slice(0, 5);
    const cards = await Promise.all(videos.map(async (vid, i) => ({
      header: {
        title: `🎬 *${vid.name}*`,
        hasMediaAttachment: true,
        imageMessage: (await generateWAMessageContent({ image: { url: vid.thumbnail } }, {
          upload: Gifted.waUploadToServer
        })).imageMessage
      },
      body: {
        text: `📺 Duration: ${vid.duration}\n👁️ Views: ${vid.views}${vid.published ? `\n📅 Published: ${vid.published}` : ""}`
      },
      footer: { text: `> *${botFooter}*` },
      nativeFlowMessage: {
        buttons: [
           {
            name: "cta_copy",
            buttonParamsJson: JSON.stringify({
              display_text: "Copy Link",
              copy_code: vid.url
            })
           },
          {
            name: "cta_url",
            buttonParamsJson: JSON.stringify({
              display_text: "Watch on YouTube",
              url: vid.url
            })
          }
        ]
      }
    })));

    const message = generateWAMessageFromContent(from, {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2
          },
          interactiveMessage: {
            body: { text: `🔍 YouTube Results for: *${q}*` },
            footer: { text: `📂 Displaying first *${videos.length}* videos` },
            carouselMessage: { cards }
          }
        }
      }
    }, { quoted: mek });

    await Gifted.relayMessage(from, message.message, { messageId: message.key.id });

      await react("✅");
    } catch (error) {
      console.error("Error during search process:", error);
      await react("❌");
      return reply("Oops! Something went wrong. Please try again.");
    }
  }
);

gmd({
    pattern: "shazam",
    aliases: ["whatmusic", "whatsong", "identify", "accr"],
    category: "search",
    react: "🙄",
    dontAddCommandList: true,
    description: "Identify music from audio or video messages"
  },
  async (from, Gifted, conText) => {
    const { mek, reply, react, botPic, quoted, quotedMsg, sender, botName, botFooter, newsletterJid } = conText;

    if (!quotedMsg) {
      await react("❌");
      return reply("Please reply to an audio or video message containing music");
    }

    const quotedAudio = quoted?.audioMessage || quoted?.message?.audioMessage;
    const quotedVideo = quoted?.videoMessage || quoted?.message?.videoMessage;
    
    if (!quotedAudio && !quotedVideo) {
      await react("❌");
      return reply("The quoted message doesn't contain any audio or video");
    }

    let tempFilePath;
    try {
      const acr = new acrcloud({
        host: 'identify-us-west-2.acrcloud.com',
        access_key: '4ee38e62e85515a47158aeb3d26fb741',
        access_secret: 'KZd3cUQoOYSmZQn1n5ACW5XSbqGlKLhg6G8S8EvJ'
      });

      tempFilePath = await Gifted.downloadAndSaveMediaMessage(quotedAudio || quotedVideo, 'temp_media');
      
      let buffer = await fs.readFile(tempFilePath);
      
      const MAX_SIZE = 1 * 1024 * 1024; // 1MB
      if (buffer.length > MAX_SIZE) {
        buffer = buffer.slice(0, MAX_SIZE);
      }
      
      const { status, metadata } = await acr.identify(buffer);
      
      if (status.code !== 0) {
        await react("❌");
        return reply(`Music identification failed: ${status.msg}`);
      }

      if (!metadata?.music?.[0]) {
        await react("❌");
        return reply("No music information found in the audio");
      }

      const { title, artists, album, genres, label, release_date } = metadata.music[0];
      
      let txt = `*${botName} 𝐒𝐇𝐀𝐙𝐀𝐌*\n\n`;
      txt += `*Title:* ${title || 'Unknown'}\n`;
      if (artists?.length) txt += `*Artists:* ${artists.map(v => v.name).join(', ')}\n`;
      if (album?.name) txt += `*Album:* ${album.name}\n`;
      if (genres?.length) txt += `*Genres:* ${genres.map(v => v.name).join(', ')}\n`;
      if (label) txt += `*Label:* ${label}\n`;
      if (release_date) txt += `*Release Date:* ${release_date}\n`;
      txt += `\n> *${botFooter}*`;

      await Gifted.sendMessage(
        from,
        {
          image: { url: botPic },
          caption: txt,
          contextInfo: {
            mentionedJid: [sender],
            forwardingScore: 5,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: newsletterJid,
              newsletterName: botName,
              serverMessageId: 143
            },
          },
        },
        { quoted: mek }
      );
      await react("✅");
    } catch (e) {
      console.error("Error in shazam command:", e);
      await react("❌");
      if (e.message.includes('empty media key')) {
        await reply("The media keys have expired - please send a fresh audio/video message");
      } else if (e.message.includes('too large')) {
        await reply("The audio is too long. Please try with a shorter clip (10-20 seconds).");
      } else {
        await reply(`❌ Error identifying music: ${e.message}`);
      }
    } finally {
      if (tempFilePath) {
        try {
          await fs.access(tempFilePath); 
          await fs.unlink(tempFilePath);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') { 
            console.error("Failed to clean up temp file:", cleanupError);
          }
        }
      }
    }
});
