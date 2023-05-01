const main = async () => {
  const app = require("./src/app");

  app.listen(8080, () => console.log("Listening on port 8080"));
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
