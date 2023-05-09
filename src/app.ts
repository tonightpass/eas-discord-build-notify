import bodyParser from "body-parser";
import crypto from "crypto";
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  AttachmentBuilder,
  Colors,
} from "discord.js";
import dotenv from "dotenv-flow";
import express from "express";
import QRCode from "qrcode";
import safeCompare from "safe-compare";
import { PassThrough } from "stream";

import { BuildPayload, SubmitPayload } from "./types";
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
        const payload = JSON.parse(req.body) as SubmitPayload | BuildPayload;

        const isBuild = "priority" in payload;
        const type = isBuild ? "Build" : "Submission";

        const embed = new EmbedBuilder()
          .setAuthor({
            name: `${payload.accountName}`,
            iconURL: "https://github.com/expo.png",
            url: `https://expo.dev/accounts/${payload.accountName}`,
          })
          .setThumbnail("https://github.com/expo.png")
          .setTimestamp()
          .setFooter({
            text: "EAS Build",
            iconURL: "https://github.com/expo.png",
          });
        const files: AttachmentBuilder[] = [];

        switch (payload.status) {
          case "canceled": {
            embed
              .setTitle(
                `🛑 ${type} Canceled - ${properCase(payload.projectName)}`
              )
              .setColor(Colors.Greyple);

            if (isBuild) {
              const buildPayload = payload as BuildPayload;
              embed
                .setDescription(
                  "The build was canceled. Please check the logs for more information."
                )
                .setURL(buildPayload.buildDetailsPageUrl || "");
            } else {
              const submissionPayload = payload as SubmitPayload;
              embed
                .setDescription(
                  "The submission was canceled. Please check the logs for more information."
                )
                .setURL(submissionPayload.submissionDetailsPageUrl || "");
            }

            break;
          }
          case "errored": {
            embed
              .setTitle(
                `⛔ ${type} Failure - ${properCase(payload.projectName)}`
              )
              .setColor(Colors.Red);

            if (isBuild) {
              const buildPayload = payload as BuildPayload;
              embed
                .setDescription(
                  "An error occurred during the build process. Please check the logs for more information."
                )
                .addFields(
                  {
                    name: "Error",
                    value: buildPayload.error?.message || "Unknown error",
                    inline: true,
                  },
                  {
                    name: "Profile",
                    value: buildPayload.metadata.buildProfile || "Unknown profile",
                    inline: true,
                  },
                  {
                    name: "Code",
                    value: buildPayload.error?.errorCode || "Unknown code",
                    inline: true,
                  }
                )
                .setURL(buildPayload.buildDetailsPageUrl || "");
            } else {
              const submissionPayload = payload as SubmitPayload;
              embed
                .setDescription(
                  "An error occurred during the submission process. Please check the logs for more information."
                )
                .addFields(
                  {
                    name: "Error",
                    value:
                      submissionPayload.submissionInfo?.error?.message ||
                      "Unknown error",
                    inline: true,
                  },
                  {
                    name: "\u200B",
                    value: "\u200B",
                    inline: true,
                  },
                  {
                    name: "Code",
                    value:
                      submissionPayload.submissionInfo?.error?.errorCode ||
                      "Unknown code",
                    inline: true,
                  }
                )
                .setURL(submissionPayload.submissionDetailsPageUrl || "");
            }

            break;
          }
          case "finished": {
            embed
              .setTitle(
                `✅ ${type} Success - ${properCase(payload.projectName)}`
              )
              .setColor(Colors.Green);

            if (isBuild) {
              const buildPayload = payload as BuildPayload;

              const qrStream = new PassThrough();
              switch (buildPayload.platform) {
                case "ios":
                  await QRCode.toFileStream(
                    qrStream,
                    `itms-services://?action=download-manifest;url=https://api.expo.dev/v2/projects/${buildPayload.appId}/builds/${buildPayload.id}/manifest.plist`,
                    {
                      type: "png",
                      width: 256,
                      errorCorrectionLevel: "H",
                    }
                  );
                  break;
                default:
                  await QRCode.toFileStream(
                    qrStream,
                    buildPayload.artifacts?.buildUrl,
                    {
                      type: "png",
                      width: 256,
                      errorCorrectionLevel: "H",
                    }
                  );
                  break;
              }

              const file = new AttachmentBuilder(qrStream).setName(
                "qrCode.jpg"
              );
              files.push(file);

              embed
                .setDescription(
                  `${
                    buildPayload.platform === "ios"
                      ? "Scan QR Code"
                      : `Direct Download Link: ${buildPayload.artifacts?.buildUrl}`
                  } `
                )
                .addFields(
                  {
                    name: "Platform",
                    value: `${buildPayload.platform}`,
                    inline: true,
                  },
                  {
                    name: "Profile",
                    value: buildPayload.metadata.buildProfile || "Unknown profile",
                    inline: true,
                  },
                  {
                    name: "App Version",
                    value:
                      `${buildPayload.metadata.appVersion}` +
                      ((buildPayload.metadata.appBuildVersion &&
                        ` (${buildPayload.metadata.appBuildVersion})`) ||
                        ""),
                    inline: true,
                  }
                )
                .setImage(`attachment://${file.name}`)
                .setURL(buildPayload.artifacts?.buildUrl || "");
            } else {
              const submissionPayload = payload as SubmitPayload;
              embed
                .setDescription(
                  `Submission Details: ${submissionPayload.submissionDetailsPageUrl}`
                )
                .addFields({
                  name: "Platform",
                  value: `${submissionPayload.platform}`,
                  inline: true,
                })
                .setURL(submissionPayload.submissionDetailsPageUrl);
            }

            break;
          }
        }

        channel && channel.send({ embeds: [embed], files });

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
