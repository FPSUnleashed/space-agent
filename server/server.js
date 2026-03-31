const { createAgentServer } = require("./app");

async function startServer(overrides = {}) {
  const app = createAgentServer(overrides);
  await app.listen();
  return app;
}

async function runServeCli(overrides = {}) {
  const app = await startServer(overrides);
  console.log(`agent-one server listening at ${app.browserUrl}`);
  return app;
}

if (require.main === module) {
  runServeCli().catch((error) => {
    console.error("Failed to start agent-one server.");
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runServeCli,
  startServer
};
