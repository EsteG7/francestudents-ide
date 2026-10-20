# FranceStudent IDE

Agent de programmation pour ia.francestudent. Trois interfaces partagent le même cœur (`src/`) :

- **Application de bureau** (Electron, Windows et macOS) : interface façon VS Code avec explorateur, éditeur, panneau Agent, terminal intégré et vue Git/GitHub ;
- **TUI** plein terminal (`frst`, Ink) ;
- **CLI classique** readline (`frstcli`).

Sans projet sélectionné, l'agent fonctionne en chat normal. Architecture détaillée : [docs/architecture.md](docs/architecture.md).

## Fonctionnalités

- Chat avec les agents disponibles (`/model`)
- Mode projet : exploration, recherche, lecture, création et édition de fichiers
- Confirmation avant chaque écriture (`/auto on` la désactive pour la session)
- Annulation de la dernière modification avec `/undo` (sauvegardes et corbeille du CLI)
- Notes persistantes par projet (`/remember`, `/memory`)
- Une conversation persistante distincte pour le chat normal et l'agent, reprise automatiquement par projet
- Saisie multi-ligne : `\` en fin de ligne pour continuer, ou bloc entre deux lignes `"""`
- Pré-prompt personnalisé, commun à tous les projets ou propre à un projet (`/preprompt`)
- Mémoire de profil qui se renforce avec l'usage : faits appris sur l'utilisateur et le projet, ajoutés au pré-prompt (`/profil`)

## Prérequis

- Node.js 22 ou plus récent, et npm
- Un compte FranceStudent
- Pour l'application de bureau : les dépendances de développement (Electron, CodeMirror, xterm.js), installées par `npm install`

## Installation

Télécharger le release correspondant à votre os

Au premier lancement, le CLI demande ton e-mail et ton mot de passe France Student (saisie masquée). Le mot de passe n'est jamais enregistré : seul le cookie de session l'est, dans `~/.francestudent-cli/session.json` (droits 0600). Commande `/login` pour se reconnecter.

Chaque utilisateur se connecte avec son propre compte : aucun identifiant n'est lu dans un fichier `.env` ni stocké dans le dépôt. Pour changer de compte, utilise `/login` (ou supprime `~/.francestudent-cli/session.json`).

Si la connexion automatique est bloquée (captcha, double authentification, Cloudflare), tu peux exporter `FS_SESSION_TOKEN` dans ton shell (valeur du cookie `next-auth.session-token`, F12 > Stockage > Cookies). Ne partage jamais cette valeur et ne la commite jamais.

`npm install` lance aussi le script `prepare`, qui construit le bundle de la TUI (`dist/tui.mjs`, via esbuild). Pour le reconstruire à la main : `npm run build:tui`.

Pour disposer des commandes `frst` et `frstcli` partout :

```bash
npm link
```

Lancement :

| Commande | Interface |
| -------- | --------- |
| `frst` (ou `npm run start:tui`) | Nouvelle interface plein terminal (TUI Ink) |
| `frst --classic` (ou `FRST_UI=classic frst`) | Ancien CLI readline |
| `frstcli` (ou `npm start`, `node index.js`) | Ancien CLI readline, directement |

`frst` ouvre automatiquement l'ancien CLI si le terminal n'est pas interactif, si `dist/tui.mjs` est absent ou si la TUI ne peut pas démarrer.

### Raccourcis clavier de la TUI

| Touche | Action |
| ------ | ------ |
| Entrée | Envoyer |
| `\` + Entrée, Ctrl+J, Alt+Entrée | Nouvelle ligne |
| ↑ / ↓ | Changer de ligne, puis parcourir l'historique (conservé entre les sessions) |
| Tab | Compléter une commande slash |
| Échap | Effacer la saisie |
| Ctrl+A / Ctrl+E | Début / fin de ligne |
| Ctrl+U / Ctrl+K | Couper jusqu'au début / jusqu'à la fin |
| Ctrl+V | Coller le presse-papiers |
| Ctrl+L | Effacer l'écran (`/clear` vide aussi l'historique affiché) |
| Ctrl+C | Interrompre la tâche, sinon effacer la saisie ; un second appui quitte |
| Ctrl+D | Quitter si la saisie est vide |

Confirmations : `o` = oui, `n` = non, `t` = toujours, Échap = non. `NO_COLOR=1` désactive les couleurs. Détails : [docs/tui.md](docs/tui.md).

## Application de bureau (Windows et macOS)

L'interface principale est une application graphique façon VS Code (Electron). Elle réutilise le même cœur que la TUI et le CLI et propose :

- un explorateur de fichiers avec menu contextuel ;
- un éditeur à onglets (CodeMirror 6, fichiers de 2 Mo maximum) ;
- un panneau Agent pour la conversation et les confirmations ;
- un panneau du bas pour la sortie des commandes et le terminal intégré (xterm.js et node-pty) : PowerShell sous Windows, `$SHELL` ailleurs (à défaut `/bin/zsh`, puis `/bin/bash`) ;
- une vue Git (branche, diff, journal, commit, Pull, Fetch et Push) avec une section GitHub (token, remote, création de dépôt). Détails : [docs/github.md](docs/github.md).

Lancement et construction :

| Commande | Rôle |
| -------- | ---- |
| `npm run desktop` | Lance l'application en développement (le renderer est reconstruit avant) |
| `npm run build:desktop` | Construit l'application sans installeur (`electron-builder --dir`) |
| `npm run dist:win` | Windows : `FranceStudentCode-<version>-portable.exe` et `FranceStudentCode-<version>-setup.exe` (NSIS) dans `release/` |
| `npm run dist:mac` | macOS (x64) : `FranceStudentCode-<version>-mac-x64.dmg` et `.zip` dans `release/` (sans signature de code) |

Sous macOS, Cmd remplace Ctrl dans les raccourcis ci-dessous.

| Raccourci | Action |
| --------- | ------ |
| Ctrl+P | Aller à un fichier (`>` pour les commandes, `:` pour une ligne) |
| Ctrl+Maj+P | Palette de commandes |
| Ctrl+Maj+F | Rechercher dans le projet (casse, regex) |
| Ctrl+Maj+E | Afficher/masquer l'explorateur |
| Ctrl+Maj+G | Afficher/masquer la vue Git |
| Ctrl+B | Afficher/masquer la barre latérale |
| Ctrl+² (ou Ctrl+`) | Afficher/masquer le terminal intégré |
| Ctrl+Maj+² (ou Ctrl+Maj+`) | Ouvrir un nouveau terminal |
| Ctrl+J | Afficher/masquer le panneau du bas |
| Ctrl+G | Aller à la ligne |
| Ctrl+N | Nouveau fichier |
| Ctrl+S / Ctrl+W / Ctrl+O | Enregistrer / fermer l'onglet / ouvrir un dossier |
| Ctrl+L | Aller à la saisie de l'agent |
| O / N / T | Répondre à une confirmation de l'agent (hors champ de saisie) |

Clic droit dans l'explorateur : nouveau fichier ou dossier, renommer, mettre à la corbeille, mentionner à l'agent, copier le chemin, afficher le fichier dans le gestionnaire de fichiers du système (Explorateur Windows ou Finder). Double-clic sur un bloc de code de la conversation pour le copier. Les tailles des panneaux sont mémorisées.

## Utilisation

Exemple de session :

```text
› /project ./mon-projet
› /tree
› Explique le rôle de src/main.js
› Ajoute une fonction de formatage de date dans src/utils/date.js
```

### Saisie multi-ligne

- Termine une ligne par `\` pour continuer sur la suivante (invite `... `).
- Tape `"""` seul sur une ligne pour ouvrir un bloc (collage possible), puis `"""` seul pour l'envoyer.

### Pré-prompt et mémoire de profil

- `/preprompt <texte>` enregistre un pré-prompt commun à tous les projets ; `/preprompt projet <texte>` en enregistre un pour le projet ouvert. Il est joint au premier message d'une conversation de chat (utilise `/new` pour l'appliquer).
- Le CLI repère les sujets récurrents de tes demandes (TypeScript, Python, React, tests, documentation, Git). À partir de 3 mentions, un sujet devient un fait dont le poids augmente à chaque nouvelle mention. Les 12 faits les plus lourds sont ajoutés au pré-prompt.
- `/profil learn <fait>` ajoute ou renforce un fait à la main, `/profil forget <n>` le supprime.
- Stockage : `~/.francestudent-cli/profile.json` (utilisateur) et `profile.json` dans le dossier de données du projet.
- Le pré-prompt et les faits sont envoyés en chat normal (premier message de la conversation) et en mode agent (message complet du premier tour, ou d'une nouvelle conversation agent).

## Commandes principales

| Commande                  | Rôle                                                  |
| ------------------------- | ----------------------------------------------------- |
| `/help`                   | Affiche l'aide                                        |
| `/project <dossier>`      | Sélectionne un projet local                           |
| `/unproject`              | Quitte le mode projet                                 |
| `/tree [dossier]`         | Liste un dossier sur deux niveaux                     |
| `/read <fichier>`         | Affiche un fichier                                    |
| `/index`                  | Régénère le résumé du projet (`RESUME.md`)            |
| `/undo`                   | Annule la dernière modification                       |
| `/changes`                | Liste les modifications annulables                    |
| `/chat-id [numéro\|id]`   | Affiche les IDs ou reprend une conversation |
| `/history [all]`          | Liste les dernières conversations (id, titre, date)   |
| `/messages`               | Affiche les messages de la session                    |
| `/memory`                 | Affiche les notes et les dernières actions            |
| `/remember <texte>`       | Ajoute une note au projet                             |
| `/preprompt [user\|projet] [texte\|clear]` | Affiche, définit ou efface le pré-prompt (utilisateur par défaut) |
| `/profil [user\|projet] [learn <fait>\|forget <n>]` | Liste, ajoute ou oublie les faits appris (poids renforcés) |
| `/permissions [remove <n\|préfixe>\|clear]` | Liste ou supprime les règles des commandes autorisées (projet) |
| `/jobs [stop <id>\|stop-all]` | Liste ou arrête les commandes en arrière-plan        |
| `/login`                  | Se connecter avec e-mail et mot de passe              |
| `/mode auto\|agent\|chat` | Choisit quand utiliser les outils fichiers            |
| `/model [id]`             | Liste ou change d'agent                               |
| `/new`                    | Démarre une nouvelle conversation                     |
| `/exit`                   | Quitte le CLI                                         |

## Développement et tests

| Commande | Rôle |
| -------- | ---- |
| `npm test` | Tests unitaires (`node --test test/*.test.js`) |
| `npm run test:e2e` | Tests de bout en bout Playwright de l'application de bureau (`e2e/`, nécessite un affichage) |
| `npm run lint` | Analyse ESLint |
| `npm run build:renderer` | Reconstruit `desktop/renderer/app.js` à partir de `desktop/renderer/src/` |
| `npm run check:renderer` | Vérifie que le renderer généré est à jour (aussi lancé en CI) |
| `npm run build:tui` | Reconstruit le bundle de la TUI (`dist/tui.mjs`) |
| `npm run rebuild:native` | Recompile les modules natifs (node-pty) pour Electron |

Documentation : [architecture](docs/architecture.md), [TUI](docs/tui.md), [outils de l'agent](docs/tools.md), [GitHub](docs/github.md), [API](docs/api.md), [SDK API](docs/sdkapi.md).
