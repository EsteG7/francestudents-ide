"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createTaskQueue({ file, workspace, canRun, run, onChange = () => {}, onSteeringFiles = null }) {
    let tasks = [];
    let enabled = false;
    let active = null;
    const attachments=require("./queue-attachments").createAttachmentStore(file);
    try {
        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        if (Array.isArray(saved.tasks)) tasks = saved.tasks.filter(t => t && typeof t.id === "string" && typeof t.prompt === "string" && typeof t.workspace === "string").map(t => ({ ...t, status: t.status === "running" ? "interrupted" : t.status === "steering" ? "pending" : t.status }));
    } catch { /* First launch or invalid queue file. */ }
    const scope = () => workspace() || "";
    const same = (a, b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
    function snapshot() {
        return { enabled, tasks: tasks.filter(t => same(t.workspace, scope())).map(t => ({ ...t })) };
    }
    function changed() {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ tasks }, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, file);
        onChange(snapshot());
    }
    function kick() { setImmediate(() => pump().catch(() => { enabled = false; onChange(snapshot()); })); }
    async function pump() {
        if (!enabled || active || !canRun()) return;
        const task = tasks.find(t => same(t.workspace, scope()) && t.status === "pending");
        if (!task) { enabled = false; onChange(snapshot()); return; }
        active = task;
        task.status = "running";
        task.startedAt = new Date().toISOString();
        changed();
        try {
            const result = await run(task.prompt, { mode: task.mode || "agent", attachments:attachments.read(task) });
            task.status = task.interrupted || result?.interrupted ? "interrupted" : result?.ok === false ? "failed" : "done";
            task.message = String(result?.error || result?.message || "").slice(0, 12000);
        } catch (error) {
            task.status = "failed";
            task.message = error.message;
        } finally {
            delete task.interrupted;
            task.finishedAt = new Date().toISOString();
            if (task.status !== "done") enabled = false;
            active = null;
            changed();
            kick();
        }
    }
    function action(kind, payload = {}) {
        if (kind === "list") return snapshot();
        const current = scope();
        const task = tasks.find(t => t.id === payload.id && same(t.workspace, current));
        if(kind==="attachments"){if(!task||task.status==="running")throw new Error("Demande indisponible pour modification.");return {attachments:attachments.read(task)};}
        switch (kind) {
            case "add": {
                const prompt = String(payload.prompt || "").trim();
                if (!prompt || prompt.length > 30000) throw new Error("Le prompt doit contenir entre 1 et 30 000 caractères.");
                if (prompt.startsWith("/")) throw new Error("Ajoute une demande à l’agent, pas une commande /…");
                if (tasks.filter(t => same(t.workspace, current)).length >= 200) throw new Error("La liste contient déjà 200 tâches. Retire les anciennes tâches.");
                const id=randomUUID();
                const files=attachments.write(id,payload.attachments||[]);
                tasks.push({ id, workspace: current, prompt, attachments:files, mode: payload.mode === "plan" ? "plan" : "agent", status: "pending", createdAt: new Date().toISOString() });
                break;
            }
            case "start": enabled = true; break;
            case "pause": enabled = false; break;
            case "steer":
                if (!task || task.status !== "pending" || task.mode === "plan") throw new Error("Cette tâche ne peut pas être transmise comme consigne.");
                if(task.attachments?.length&&!onSteeringFiles)throw new Error("Les pièces jointes ne sont pas prises en charge par ce consommateur de consignes.");
                task.status = "steering";
                break;
            case "retry":
                if (!task || task.status === "running") throw new Error("Cette tâche ne peut pas être relancée.");
                task.status = "pending";
                task.message = "";
                break;
            case "edit": {
                if (!task || task.status === "running") throw new Error("Impossible de modifier la tâche en cours.");
                const prompt = String(payload.prompt || "").trim();
                if (!prompt || prompt.length > 30000 || prompt.startsWith("/")) throw new Error("Prompt invalide.");
                if(Object.hasOwn(payload,"attachments"))task.attachments=attachments.write(task.id,payload.attachments);
                task.prompt = prompt;
                task.status = "pending";
                task.message = "";
                break;
            }
            case "remove":
                if (!task || task.status === "running") throw new Error("Impossible de retirer une tâche en cours.");
                attachments.remove(task.id);
                tasks = tasks.filter(t => t !== task);
                break;
            case "move": {
                if (!task || task.status !== "pending") throw new Error("Seules les tâches en attente peuvent être déplacées.");
                const pending = tasks.filter(t => same(t.workspace, current) && t.status === "pending");
                const other = pending[pending.indexOf(task) + (payload.direction === "up" ? -1 : 1)];
                if (other) {
                    const a = tasks.indexOf(task), b = tasks.indexOf(other);
                    [tasks[a], tasks[b]] = [tasks[b], tasks[a]];
                }
                break;
            }
            case "clear":
                for(const item of tasks)if(same(item.workspace,current)&&["done","steered"].includes(item.status))attachments.remove(item.id);
                tasks = tasks.filter(t => !same(t.workspace, current) || !["done", "steered"].includes(t.status)); break;
            default: throw new Error("Action de tâche inconnue.");
        }
        changed();
        kick();
        return snapshot();
    }
    function pause({ interrupt = false } = {}) {
        enabled = false;
        if (interrupt && active) active.interrupted = true;
        onChange(snapshot());
    }
    function takeSteering() {
        const waiting = tasks.filter(t => same(t.workspace, scope()) && t.status === "steering");
        const transmitted=[];
        if (waiting.length) {
            for (const task of waiting) {
                let extra="";
                if(task.attachments?.length){
                    try{extra=onSteeringFiles?.(attachments.read(task));}
                    catch(error){task.status="pending";task.message=error.message;enabled=false;continue;}
                    if(extra==null)continue;
                }
                transmitted.push(task.prompt+(extra?"\n\n"+extra:""));
                task.status = "steered"; task.message = "Consigne et pièces jointes transmises à la tâche en cours.";
            }
            changed();
        }
        return transmitted;
    }
    function releaseSteering() {
        const waiting = tasks.filter(t => t.status === "steering");
        if (waiting.length) { for (const task of waiting) task.status = "pending"; changed(); }
    }
    return { action, snapshot, kick, pause, takeSteering, releaseSteering };
}
module.exports = { createTaskQueue };
