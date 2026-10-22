"use strict";
const connector = require("../github-connector");
module.exports = {
    name: "github",
    check(args) { if (!connector.ACTIONS.has(args.action)) throw new Error("Action GitHub inconnue."); },
    describe: args => `${args.action}${args.path ? " · " + args.path : ""}${args.tag ? " · " + args.tag : ""}`,
    async run(args) {
        const { state } = require("../state"), { ui } = require("../ui-bridge");
        if (!connector.READ_ACTIONS.has(args.action) && !await ui.confirm(`GitHub : ${args.action} sur le dépôt origin du projet ?`)) return { denied: true, message: "Action GitHub refusée." };
        return connector.execute(state.workspace, args);
    }
};
