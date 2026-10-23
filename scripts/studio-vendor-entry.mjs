import { marked } from "marked";
import DOMPurify from "dompurify";
import Fuse from "fuse.js";
import { createElement, LayoutDashboard, Play, Square, RefreshCw, Terminal, Activity, BookOpen, Eye, Command, Settings, FileCode, Check, AlertCircle, Copy, Search, Sparkles, ExternalLink, GitCompare, Keyboard, FolderOpen } from "lucide";
const icons = {LayoutDashboard, Play, Square, RefreshCw, Terminal, Activity, BookOpen, Eye, Command, Settings, FileCode, Check, AlertCircle, Copy, Search, Sparkles, ExternalLink, GitCompare, Keyboard, FolderOpen};
globalThis.StudioVendor = {
    Fuse,
    markdown(source) {
        return DOMPurify.sanitize(marked.parse(String(source), {gfm:true, breaks:false}), {
            USE_PROFILES:{html:true}, FORBID_TAGS:["img","input","form","style","iframe"], FORBID_ATTR:["style"], SANITIZE_NAMED_PROPS:true
        });
    },
    icon(name) { return icons[name] ? createElement(icons[name], {width:18,height:18,"stroke-width":1.6,"aria-hidden":"true"}) : null; }
};
