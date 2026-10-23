# Contexte de reprise — développeurs et assistants IA

Ce document est volontairement indépendant d’un fournisseur et d’un modèle. Il se lit comme du Markdown ordinaire. Commencer par [AGENTS.md](../AGENTS.md), puis consulter les sections utiles à la tâche.

## Mission du projet

FranceStudent IDE associe un éditeur de code, un agent de programmation et un studio motion design EffectCraft à un compte FranceStudent. L’interface est en français, accessible aux débutants, avec des options avancées. Le travail de l’agent doit rester visible et interruptible ; l’interface doit expliquer ses limites sans exposer le protocole technique du modèle.

Le projet original appartient à [EsteG7](https://github.com/EsteG7/francestudents-ide). Le fork de publication est [extraopaa/francestudents-ide](https://github.com/extraopaa/francestudents-ide). Conserver cette distinction, les crédits et les licences tierces.

## État de référence, daté du 23 octobre 2026

- Version de référence de ce contexte : **1.3.3**. Vérifier sur GitHub le statut de publication effectif et les éventuelles versions plus récentes ; la version du paquet ne suffit pas à le prouver.
- Le tag v1.3.1 existe, mais aucune release v1.3.1 n’était publiée lors de la vérification. Ne pas déplacer ou réutiliser un tag public.
- Nom d’application : **FranceStudent IDE** ; les anciens noms « FranceStudent Code » restent parfois nécessaires pour préserver les données ou désigner une version historique.
- Validation locale : 678 tests unitaires, dont 675 réussis et 3 hooks Unix ignorés sous Windows ; 25 parcours Electron réussis. Consulter le [rapport de validation](validation-v1.3.3.md) pour les limites, puis relancer les contrôles adaptés aux nouveaux changements.
- Les API distantes et mutations GitHub sont simulées dans les scénarios automatisés. Le vrai moteur EffectCraft, le terminal PTY et les serveurs locaux ont été exécutés. Roblox Studio réel et l’installation par-dessus l’application principale n’ont pas été validés.

Cet état est un instantané. Vérifier le dépôt et les releases avant de s’appuyer sur ces numéros ; mettre cette section à jour après publication.

## Carte du code

| Zone | Fichiers ou dossiers à lire |
| --- | --- |
| Entrées CLI, TUI, routage | `index.js`, `bin/`, `src/core/`, `src/cli/` |
| Boucle agent et protocole JSON | `src/agent/agent.js`, `src/agent/prompt.js` |
| Client de chat, flux et relances | `src/api/api.js`, `src/api/auth.js`, `src/api/account.js` |
| Contexte et compaction | `src/agent/auto-compact.js`, `src/api/context-limits.js`, `docs/model-context.md` |
| Outils, politique et annulation | `src/tools/registry.js`, `src/tools/command/`, `src/tools/action-control.js` |
| MCP et images de résultats | `src/mcp/manager.js`, `src/mcp/tool.js` |
| Images et pièces jointes | `src/api/image-input.js`, `src/api/visual-receipt.js`, `src/api/attachment-batches.js`, `desktop/queue-attachments.js`, `docs/attachments.md` |
| Electron et pont de sécurité | `desktop/main.js`, `desktop/preload.js`, `desktop/backend.js` |
| Interface et identité visuelle | `desktop/renderer/index.html`, `theme.css`, `controls.css`, `surfaces.css`, `workbench.css`, `motion.css` |
| Modules source de l’interface | `desktop/renderer/src/00-*.js` à `99-boot.js` ; assemblage par `scripts/build-renderer.js` |
| Fenêtres secondaires et confirmations | `desktop/renderer/src/46-shared-surfaces.js` |
| Historique visible et reprise | `desktop/conversation-transcript.js`, `src/project/conversations.js`, `desktop/renderer/src/42-conversation-replay.js` |
| Conversations indépendantes code/motion | `desktop/motion-conversations.js`, `desktop/renderer/src/38-motion-studio.js`, `src/motion-workspace.js` |
| EffectCraft et commandes du moteur | `desktop/effectcraft-host.js`, `desktop/effectcraft-control.js`, `src/effectcraft-protocol.js`, `src/tools/effectcraft.js` |
| Skills, marketplace code et motion | `src/skills/`, `desktop/extension-center.js`, `desktop/marketplace.js`, `desktop/motion-marketplace.js` |
| Import de conversations Codex | `desktop/conversation-import.js`, `desktop/renderer/src/28-conversation-import.js`, `docs/conversation-import.md` |
| Connecteur GitHub | `src/github-connector.js`, `desktop/renderer/src/33-github-connector.js`, `docs/github.md` |
| Erreurs API, quota et compte à rebours | `desktop/renderer/src/31-usage.js`, `39-budget-notice.js`, `43-context-notice.js`, `44-api-notices.js` |
| Mise à jour et nouveautés | `desktop/updates.js`, `desktop/startup-updates.js`, `desktop/release-highlights.js`, `desktop/renderer/src/45-release-highlights.js` |
| Tests | `test/*.test.js`, `test/helpers/isolate-env.cjs`, `e2e/*.e2e.test.js` |

Les noms de fichiers servent de repères, pas de liste exhaustive. Utiliser la recherche dans le code pour retrouver les appels réels et consulter aussi [l’architecture](architecture.md).

## Invariants à préserver

### Interface et séparation des espaces

Le chat code et le chat motion ont leurs propres échanges. EffectCraft est le vrai moteur Rust/WASM embarqué, hébergé localement dans une iframe isolée. Le chat motion ne doit jamais explorer automatiquement le projet ouvert dans le code, même en Full accès. Ses rendus et skills de projet utilisent un espace distinct.

Le marketplace code conserve SkillsMP. La sélection motion distingue les skills natifs EffectCraft et les skills Remotion destinés aux projets de code : les seconds ne pilotent pas directement EffectCraft.

L’interface utilise les couleurs, espacements, boutons, badges et fenêtres partagés. Conserver les identifiants des éléments utilisés par les événements et tests. Vérifier le clavier, l’annulation, la restitution du focus, le défilement et les petites fenêtres. Les actions destructives se distinguent en rouge. Éviter de réintroduire `window.confirm` quand `confirmStudioAction` convient.

### Historique, contexte et titres

Le journal utilisateur visible ne se confond pas avec les prompts techniques ni avec la fenêtre de contexte du fournisseur. Une compaction peut créer une nouvelle conversation serveur tout en conservant un historique visible continu. Ouvrir un nouveau chat vide son affichage, sans effacer les conversations sauvegardées.

Les limites réelles observées par l’API peuvent être inférieures aux capacités annoncées d’un modèle. Toute erreur « maximum token limit » doit pouvoir déclencher une compaction et une reprise bornée, même sans valeur numérique. Ne pas créer de boucle infinie de relances.

Les titres IA sont proposés dans la réponse finale habituelle de l’agent via `conversation_title`, sans requête séparée. Les titres manuels et ceux des anciennes conversations sont protégés.

### Images et consommation

Les images sont préparées, transmises et leur réception visuelle est vérifiée au début ; ne pas réintroduire une question de mémoire tous les quelques tours. Les descriptions peuvent survivre à la compaction sans renvoyer systématiquement les images. Les images MCP doivent rejoindre le circuit de vision, pas être remplacées par un marqueur texte.

Le service peut limiter les pièces jointes par requête ; l’application prépare des lots. Préserver les fichiers, l’ordre, l’association à la bonne tâche et l’avertissement de consommation. Ne jamais prétendre que le modèle a vu une image dont la réception a échoué.

Le quota est relu silencieusement toutes les 15 minutes pendant l’ouverture de l’IDE. Le bouton « J’ai reçu un reset » vérifie l’API : il ne modifie pas le quota et ne doit pas annoncer une disponibilité non confirmée. Une vérification de quota ne doit pas relancer une tâche de modification.

### Permissions et stockage

Le mode Full accès est une fonctionnalité volontaire. Il conserve des actions visibles et annulables ; les modes plus restrictifs doivent garder leurs confirmations et politiques. Ne pas modifier les préférences personnelles pour obtenir des tests verts.

Le produit a changé de nom, mais son `build.appId` et le nom interne du paquet (`project-frstcli`) restent stables pour la continuité des mises à jour et des profils. Electron déduit son dossier de profil de ce nom interne : ne pas le remplacer par un dossier nommé selon le nouveau nom commercial. `FS_DATA_DIR`, `FS_STATE_DIR` et `FS_SKILLS_DIR` permettent d’isoler les essais. Ne pas partager de données d’authentification entre tests et environnement réel.

## Développer et vérifier

Prérequis : Node.js >= 22.13, npm et Git. Les tests Electron ont besoin d’un environnement graphique. La validation locale de référence utilisait Node 24.21.0 et Electron 38.8.6 sous Windows ; la CI déclare d’autres plateformes, sans constituer une preuve que chaque version y a été testée.

```sh
npm install
npm run build:renderer
npm run desktop
npm run lint
npm test
node --test --test-concurrency=4 e2e/*.e2e.test.js
```

Pour un seul fichier unitaire en conservant l’isolation :

```sh
node --require ./test/helpers/isolate-env.cjs --test test/conversations-manage.test.js
```

Modifier uniquement les sources de l’interface, puis reconstruire le bundle **versionné** `desktop/renderer/app.js`. Un nouveau module `NN-nom.js` partage la portée des autres : éviter les collisions de noms et respecter l’ordre d’initialisation. `npm run check:renderer` vérifie la cohérence.

Pour EffectCraft, lire [les prérequis Rust/WASM](avance.md#motion-design-avec-effectcraft--bêta), puis utiliser `npm run vendor:effectcraft` et `npm run check:effectcraft`. Les sources téléchargées dans `release/` et le build dans `desktop/vendor-effectcraft/` sont ignorés. Le correctif source versionné est la base reproductible ; ne pas livrer une modification faite uniquement dans ces dossiers ignorés. `.gitattributes` garde les correctifs `.patch` en LF pour leurs empreintes.

## Construire et publier

La procédure complète est dans [CONTRIBUTING.md](../CONTRIBUTING.md). Une commande locale Windows utilisée avec succès est :

```sh
npx electron-builder --win nsis --publish never --config.npmRebuild=false
```

`npmRebuild=false` utilise les binaires précompilés présents de `node-pty` ; ce n’est pas une preuve de compatibilité sur une autre architecture. Tester le terminal dans l’application empaquetée. Si Windows/OneDrive verrouille une sortie de build, choisir un nouveau dossier de sortie plutôt que supprimer ou arrêter des processus utilisateur.

Avant publication : actualiser version, changelog et résumé embarqué des nouveautés ; vérifier le commit et le tag exacts ; construire, tester et calculer les empreintes. Ne pas déplacer un tag public pour y cacher de nouvelles modifications. Vérifier les workflows existants dans `.github/workflows/` : un workflow présent peut être désactivé dans les réglages du fork.

Avec `gh`, préciser le dépôt de destination pour éviter toute résolution vers l’amont : `-R extraopaa/francestudents-ide`. Les assets portent les noms déclarés dans `package.json`. Ne publier aucun exécutable dans Git et ne pas joindre un portable aux releases stables de ce fork.

## Passer le relais

Donner au prochain contributeur : l’objectif restant, les fichiers touchés, l’état Git, les vérifications réellement exécutées et les blocages précis. Ne jamais laisser un simple « tout est testé » sans périmètre ni résultat. Mettre ce document à jour en cas de changement structurel ; garder l’historique détaillé dans Git et le changelog.

Exemple à copier dans n’importe quel assistant :

> Je reprends ce dépôt. Lis AGENTS.md, CONTRIBUTING.md et docs/AI_CONTEXT.md. Vérifie ensuite l’état Git et la version locale, puis examine le code utile à ma demande. Préserve les changements existants et ne publie rien sans demande explicite. Ma demande : …
