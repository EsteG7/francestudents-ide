# FranceStudent IDE

## Prérequis

- Node.js 22 ou plus récent, et npm
- Un compte FranceStudent
- Pour l'application de bureau : les dépendances de développement (Electron, CodeMirror, xterm.js), installées par `npm install`

## Installation

Téléchargez le release correspondant à votre os


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


