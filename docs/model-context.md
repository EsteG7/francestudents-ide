# Compaction automatique et capacités de contexte

Catalogue vérifié le 22 octobre 2026 avec `GET /chats/agents` (15 modèles actifs).
Les capacités ci-dessous viennent des documentations officielles des fournisseurs.
Le service FranceStudent peut imposer une limite inférieure : ses métadonnées
explicites et son pourcentage d’occupation sont prioritaires.

| Modèle du catalogue FranceStudent | Fenêtre en tokens | Sortie maximale en tokens | Source |
| --- | ---: | ---: | --- |
| GPT 5.6 Terra | 1 050 000 | 128 000 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-terra) |
| GPT 5.6 Luna | 1 050 000 | 128 000 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-luna) |
| GPT 5.6 Sol | 1 050 000 | 128 000 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-sol) |
| GPT 6 Sol | 1 050 000 | 128 000 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| GPT 6 Luna | 1 050 000 | 128 000 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| GPT 6.1 Sol | 1 050 000 | 128 000 | [OpenAI](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| Claude Haiku 4.5 | 200 000 | 64 000 | [Anthropic](https://platform.claude.com/docs/en/models/haiku-4-5/overview) |
| Claude Sonnet 5 | 1 000 000 | 128 000 | [Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-windows) |
| Claude Opus 5 | 1 000 000 | 128 000 | [Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-windows) |
| Claude Opus 5.5 | 1 000 000 | 128 000 | [Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-windows) |
| Claude Haiku 5.5 | 1 000 000 | 128 000 | [Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-windows) |
| Claude Sonnet 5.5 | 1 000 000 | 128 000 | [Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-windows) |
| Claude Fable 5.1 | 1 000 000 | 128 000 | [Anthropic](https://platform.claude.com/docs/en/build-with-claude/context-windows) |
| Gemini 3.1 Pro (`gemini-pro-agent`) | 1 048 576 | 65 536 | [Google](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview) |
| Gemini 3.8 Flash (`gemini-3.8-flash-tiered`) | 1 048 576 | 65 536 | [Google](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash) |

La capacité n’est jamais déduite du seul fournisseur. Les alias Gemini sont ceux
observés dans le catalogue du service à cette date. Un modèle inconnu utilise les
limites explicites éventuellement fournies par le catalogue ; sans capacité
vérifiable, seules une occupation serveur d’au moins 95 % ou une erreur explicite
de dépassement déclenchent la compaction.

Le seuil automatique est de 95 % de la fenêtre du modèle. Le prochain message
est inclus dans la projection, avec une réserve de réponse plafonnée à 8 192
tokens, à 2 % de la fenêtre et à la sortie maximale du modèle. La sortie maximale
théorique complète n’est pas réservée à chaque tour. `FS_AUTO_COMPACT_TOKENS`
reste disponible comme plafond explicite ; sa valeur par défaut est `0` (auto).

Avant une compaction estimée, l’application interroge
`GET /chats/{chatId}/usage`. Un pourcentage faible annule la compaction, même si
l’estimation locale est élevée. Ce résultat est conservé pendant 30 secondes,
en tenant compte des nouveaux tours. Un changement de modèle invalide la mesure.
Si l’endpoint est indisponible, l’estimation propre au modèle prend le relais.

Le contexte retenu correspond à l’entrée et à la sortie du dernier appel réussi,
et peut diminuer si le serveur réduit son historique. Les coûts cumulés des
relances ou des lots ne sont pas ajoutés à cette occupation. Les événements SSE
de fin du fournisseur et du backend ne sont comptés qu’une fois par requête.
Les lectures/écritures de cache Anthropic sont incluses ; le cache OpenAI, déjà
inclus dans l’entrée, n’est pas ajouté une seconde fois. Sans mesure de tokens,
une estimation du texte UTF-8 est utilisée.

Le suivi local reste propre à la session de l’application. Une erreur explicite
de contexte trop long conserve le mécanisme de récupération existant. Le modèle
n’est jamais changé automatiquement, et un résumé échoué conserve la conversation.
