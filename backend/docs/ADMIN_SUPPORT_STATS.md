# Dashboard admin : support, avis, commandes en direct, statistiques

Les 6 manques sont couverts. Tous les appels : `Authorization: Bearer <token>`, préfixe `/api`. Réponses `{ success, data }` ; erreurs `{ success:false, code, message, field? }`. Les routes `/admin/*` sont réservées au rôle `ADMIN` (401 sans jeton, 403 pour un autre rôle).

## 0. Période (`range`)
Pour tous les endpoints de statistiques : `?range=today|7d|30d|90d`, ou `?from=YYYY-MM-DD&to=YYYY-MM-DD` (jours de Dakar, 366 jours max). Défaut : 7 jours. Les réponses donnent aussi la **période précédente** de même durée pour la comparaison.

## 1. Une seule requête pour le tableau de bord
`GET /admin/stats/overview?range=7d`
```json
{ "range": {"from":"2026-10-09","to":"2026-10-15","days":7,"preset":"7d"}, "previousRange": {"from":"2026-10-02","to":"2026-10-08","days":7},
  "orders":   { "total":120, "delivered":88, "cancelled":14, "inProgress":6, "awaitingRestaurant":2, "byStatus":{"DELIVERED":88,"CANCELLED":14},
                "rejectedByRestaurant":5, "cancelledBy":{"CUSTOMER":6,"VENDOR":5,"ADMIN":1,"SYSTEM":2},
                "previous":{"total":100,"delivered":70,"cancelled":10,"rejectedByRestaurant":3}, "totalChangePct":20, "deliveredChangePct":25.7 },
  "live":     { "inProgress":6, "awaitingRestaurant":2, "preparing":2, "readyForPickup":1, "onTheWay":1, "withoutRider":1, "stuck":1, "awaitingPayment":3 },
  "signups":  { "clients":{"current":40,"previous":32,"change":8,"changePct":25}, "restaurants":{...}, "drivers":{...}, "previousRange":{...} },
  "partners": { "restaurants":{"total":6,"approved":6,"pending":0,"suspended":0,"rejected":0,"acceptingOrders":4}, "drivers":{"total":3,"approved":3,"pending":0,"suspended":0,"rejected":0,"onDuty":2} },
  "reviews":  { "count":30,"averageDriverRating":4.6,"averageDishRating":4.4,"dishRatingsCount":50,"lowRated":2,"distribution":{"1":1,"2":1,"3":2,"4":8,"5":18},"flaggedOpen":1,"previous":{...},"countChangePct":12.5 },
  "support":  { "open":3,"inProgress":2,"resolved":10,"closed":40,"total":55,"openByCategory":{"DELIVERY":2},"avgFirstResponseMinutes":14.5,"avgResolutionHours":6.2 },
  "finance":  { ... meme contenu que GET /admin/finance/summary ... },
  "generatedAt": "..." }
```
- Les commandes comptées sont des commandes (une commande multi-restaurants compte une ligne par restaurant).
- `changePct` vaut `null` quand la période précédente est à 0 et la courante non (pas de division par zéro).
- « Refusées par le restaurant » = annulées par le restaurant (`cancelledBy = VENDOR`).

## 2. Commandes en direct (plateforme entière)
`GET /admin/orders/live?problem=stuck|no_rider&limit=50&list=false`
- `counts` : `inProgress` (payées, pas terminées), `awaitingRestaurant`, `preparing`, `readyForPickup`, `onTheWay`, `withoutRider` (prêtes sans livreur), `stuck` (mêmes seuils que `/admin/orders/needs-attention`), `awaitingPayment` (non payées depuis moins d'1 h).
- `data` : les commandes (même format OrderView admin que le reste), les plus anciennes d'abord, 200 max. `problem=stuck|no_rider` filtre la liste. `list=false` ne renvoie que les compteurs (pour le bandeau, à rafraîchir toutes les 30 s).

## 3. Support et réclamations
Qui ouvre : un client, un restaurant ou un livreur (jamais un admin). Une personne ne voit que ses tickets (404 sinon).

**Côté personne** (apps client / restaurant / livreur)
- `POST /support/tickets` `{ "category": "DELIVERY", "subject": "...", "message": "...", "orderId": "..."? }`
  - catégories : `ORDER, PAYMENT, DELIVERY, FOOD_QUALITY, ACCOUNT, APP, OTHER` ; sujet 3-120, message 5-2000 caractères, sans `<` `>`. `orderId` doit être **sa** commande (client = sa commande, restaurant = commande de son restaurant, livreur = sa course).
  - 5 demandes ouvertes maximum (429 `TOO_MANY_TICKETS`), 10 créations par heure.
- `GET /support/tickets?status=&page=&pageSize=` · `GET /support/tickets/:id` (messages sans les notes internes) · `POST /support/tickets/:id/messages` `{ "message": "..." }`
  - Répondre à un ticket `RESOLVED` le rouvre. Ticket `CLOSED` : 409 `TICKET_CLOSED`.

**Côté admin**
- `GET /admin/support/tickets?status=&category=&priority=&assignedTo=none|<adminId>&userId=&orderId=&q=&page=&pageSize=` : tickets ouverts d'abord, urgents d'abord, puis les plus anciens ; chaque ligne porte `user {id,name,phone,role}` et `messageCount`.
- `GET /admin/support/tickets/:id` : tout le fil, notes internes comprises.
- `PATCH /admin/support/tickets/:id` `{ status?, priority?, assignedTo? (id d'un admin ou null), resolution? }`
  - statuts : `OPEN → IN_PROGRESS → RESOLVED → CLOSED` (tout changement permis) ; passer à `RESOLVED` demande une `resolution` (400 `field: resolution`).
  - priorités : `LOW, NORMAL, HIGH, URGENT`.
- `POST /admin/support/tickets/:id/messages` `{ "message": "...", "internal": false }` : une réponse visible passe un ticket `OPEN` en `IN_PROGRESS` et date la première réponse ; une note `internal: true` n'est jamais montrée à la personne.
- `GET /admin/support/stats?range=30d` : `open, inProgress, resolved, closed, total, openByCategory, avgFirstResponseMinutes, avgResolutionHours`.

## 4. Avis clients
- `GET /admin/reviews?rating=1..5&flagged=true|false&vendorId=&driverId=&from=&to=&page=&pageSize=` → chaque avis : note du livreur, tags, notes, avis par plat, `customer`, `restaurant`, `driver`, `flagged`, `flagReason`, `flaggedBy` (`ADMIN:<id>` ou `VENDOR:<id>`), `flaggedAt`.
- `GET /admin/reviews/stats?range=30d` : `count, averageDriverRating, averageDishRating, lowRated (≤ 2), distribution {1..5}, flaggedOpen`, et `previous` + `countChangePct`.
- `PATCH /admin/reviews/:id/flag` `{ "flagged": true, "reason": "..." }` pour signaler, `{ "flagged": false }` pour lever le signalement.
- Restaurant : `POST /reviews/:id/report` `{ "reason": "..." }` (rôle `VENDOR`, avis de **son** restaurant uniquement, 404 sinon). Il ne peut jamais lever un signalement.

## 5. Sécurité
Rôles vérifiés à chaque route ; propriété vérifiée sur chaque ticket et chaque commande liée ; entrées strictement validées (champs inconnus, caractères de contrôle, `<` `>`, tailles) ; limites de débit (création de ticket, messages, signalements, écritures admin) ; modifications admin dans le journal d'audit ; ticket verrouillé pendant une écriture (pas de course entre deux réponses) ; aucune donnée de ces écrans n'est exposée aux apps client / restaurant / livreur au-delà de leurs propres tickets.
