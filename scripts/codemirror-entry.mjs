// Point d'entrée du bundle CodeMirror 6 pour le renderer (sans modules ES ni CDN).
// esbuild l'assemble en desktop/renderer/vendor/codemirror.js, qui expose window.CM.
import { basicSetup } from "codemirror";
import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { indentUnit } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

function languageFor(kind) {
    switch (kind) {
        case "js": return javascript({ jsx: true });
        case "ts": return javascript({ typescript: true, jsx: true });
        case "json": return json();
        case "css": return css();
        case "html": return html();
        case "md": return markdown();
        case "py": return python();
        default: return [];
    }
}

/* globalThis === window dans le bundle IIFE chargé par le renderer (et évite no-undef côté ESLint/Node). */
globalThis.CM = {
    basicSetup,
    EditorState,
    EditorSelection,
    EditorView,
    Compartment,
    keymap,
    indentWithTab,
    indentUnit,
    openSearchPanel,
    oneDark,
    languageFor
};
