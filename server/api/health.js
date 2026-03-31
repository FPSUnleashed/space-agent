module.exports = {
  get(context) {
    const browserAppUrl = context.requestUrl ? context.requestUrl.origin : context.browserUrl;

    return {
      ok: true,
      name: "agent-one-server",
      browserAppUrl,
      responsibilities: [
        "serve the browser app during development",
        "proxy outbound fetch calls",
        "manage sqlite persistence"
      ]
    };
  }
};
