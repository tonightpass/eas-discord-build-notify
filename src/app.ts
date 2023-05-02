import bodyParser from "body-parser";
import crypto from "crypto";
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  AttachmentBuilder,
} from "discord.js";
import dotenv from "dotenv-flow";
import express from "express";
import QRCode from "qrcode";
import safeCompare from "safe-compare";
import { PassThrough } from "stream";

import properCase from "./utils/properCase";

dotenv.config({
  silent: true,
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});
let channel;

client.on("ready", async () => {
  channel = await client.channels.fetch(String(process.env.DISCORD_CHANNEL_ID));
});

client.login(String(process.env.DISCORD_BOT_TOKEN));

const app = express();
app.use(bodyParser.text({ type: "*/*" }));

app.post("/webhook", async (req, res) => {
  const expoSignature = req.headers["expo-signature"];

  // process.env.EAS_SECRET_WEBHOOK_KEY has to match SECRET value set with `eas webhook:create` command
  const hmac = crypto.createHmac(
    "sha1",
    process.env.EAS_SECRET_WEBHOOK_KEY || ""
  );

  try {
    hmac.update(req.body);
    const hash = `sha1=${hmac.digest("hex")}`;

    if (!safeCompare(expoSignature, hash)) {
      res.status(500).send("Signatures didn't match");
    } else {
      try {
        const { id, appId, status, artifacts, metadata, platform, error } =
          JSON.parse(req.body);

        const username = metadata?.username;

        const buildUrl = `https://expo.io/accounts/${
          metadata?.trackingContext?.account_id ||
          process.env.EXPO_DEFAULT_TEAM_NAME
        }/projects/${metadata?.appName}/builds/${id}`;

        switch (status) {
          case "finished": {
            const qrStream = new PassThrough();
            switch (platform) {
              case "ios":
                await QRCode.toFileStream(
                  qrStream,
                  `itms-services://?action=download-manifest;url=https://api.expo.dev/v2/projects/${appId}/builds/${id}/manifest.plist`,
                  {
                    type: "png",
                    width: 256,
                    errorCorrectionLevel: "H",
                  }
                );
                break;
              default:
                await QRCode.toFileStream(qrStream, artifacts?.buildUrl, {
                  type: "png",
                  width: 256,
                  errorCorrectionLevel: "H",
                });
                break;
            }

            const file = new AttachmentBuilder(qrStream).setName("qrCode.jpg");

            if (client.isReady()) {
              const successEmbed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(
                  `✅ Build Success - ${properCase(metadata.buildProfile)}`
                )
                .setURL(buildUrl)
                .setAuthor({
                  name: `${username}`,
                  iconURL:
                    "https://raw.githubusercontent.com/Player2Dev/Player2-Assets/main/assets/expo_logo.png",
                })
                .setDescription(
                  `${
                    platform === "ios"
                      ? "Scan QR Code"
                      : `Direct Download Link: ${artifacts?.buildUrl}`
                  } `
                )
                .setThumbnail(
                  "https://raw.githubusercontent.com/Player2Dev/Player2-Assets/main/assets/expo_logo.png"
                )
                .addFields(
                  {
                    name: "Platform",
                    value: `${platform}`,
                    inline: true,
                  },
                  {
                    name: "\u200B",
                    value: "\u200B",
                    inline: true,
                  },
                  {
                    name: "App Version",
                    value:
                      `${metadata?.appVersion}` +
                      ((metadata?.appBuildVersion &&
                        ` (${metadata?.appBuildVersion})`) ||
                        ""),
                    inline: true,
                  }
                )
                .setImage("attachment://qrCode.jpg")
                .setTimestamp()
                .setFooter({
                  text: "EAS Build",
                  iconURL:
                    "https://raw.githubusercontent.com/Player2Dev/Player2-Assets/main/assets/expo_logo.png",
                });

              channel &&
                channel.send({
                  embeds: [successEmbed],
                  files: [file],
                });
            }
            break;
          }
          case "errored": {
            if (client.isReady()) {
              const errorEmbed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle(
                  `⛔ Build Failure - ${properCase(metadata.buildProfile)}`
                )
                .setURL(buildUrl)
                .setAuthor({
                  name: `${username}`,
                  iconURL:
                    "https://raw.githubusercontent.com/Player2Dev/Player2-Assets/main/assets/expo_logo.png",
                })
                .setDescription(`Click URL for more more details: ${buildUrl}`)
                .setThumbnail(
                  "https://raw.githubusercontent.com/Player2Dev/Player2-Assets/main/assets/expo_logo.png"
                )
                .addFields(
                  {
                    name: "Platform",
                    value: `${platform}`,
                    inline: true,
                  },
                  {
                    name: "\u200B",
                    value: "\u200B",
                    inline: true,
                  },
                  {
                    name: "App Version",
                    value:
                      `${metadata?.appVersion}` +
                      ((metadata?.appBuildVersion &&
                        ` (${metadata?.appBuildVersion})`) ||
                        ""),
                    inline: true,
                  },
                  {
                    name: "Error Code",
                    value: `${error?.errorCode}`,
                    inline: true,
                  },
                  {
                    name: "\u200B",
                    value: "\u200B",
                    inline: true,
                  },
                  {
                    name: "Error Message",
                    value: `${error?.message}`,
                    inline: true,
                  }
                )
                .setTimestamp()
                .setFooter({
                  text: "EAS Build",
                  iconURL:
                    "https://raw.githubusercontent.com/Player2Dev/Player2-Assets/main/assets/expo_logo.png",
                });

              channel && channel.send({ embeds: [errorEmbed] });
            }
            break;
          }
          default:
            console.warn(req.body);
            break;
        }

        res.send("OK");
      } catch (err) {
        res.status(500).send("Error parsing payload");
      }
    }
  } catch (err) {
    res.status(500).send("Payload Body is empty");
  }
});

export default app;
