/// Big emoji for a live menu category (the rail shows whatever categories the menus really have).
String categoryEmoji(String label) {
  final l = label.toLowerCase();
  const table = <(List<String>, String)>[
    (['all'], '🍽️'),
    (['burger'], '🍔'),
    (['pizza'], '🍕'),
    (['roll', 'wrap', 'shawarma', 'kebab'], '🌯'),
    (['thali', 'meal', 'combo'], '🍛'),
    (['biryani', 'rice'], '🍚'),
    (['chinese', 'noodle', 'momo'], '🍜'),
    (['coffee', 'tea', 'chai'], '☕'),
    (['beverage', 'drink', 'juice', 'shake', 'lassi', 'soda'], '🥤'),
    (['ice cream'], '🍨'),
    (['dessert', 'sweet', 'cake', 'pastry'], '🍰'),
    (['paratha', 'roti', 'bread', 'naan'], '🫓'),
    (['sandwich', 'toast'], '🥪'),
    (['snack', 'fries', 'starter', 'fast food'], '🍟'),
    (['chicken', 'tandoor', 'grill'], '🍗'),
    (['breakfast', 'egg'], '🍳'),
    (['dosa', 'south indian', 'idli'], '🥞'),
    (['salad', 'healthy'], '🥗'),
    (['night'], '🌙'),
  ];
  for (final (keys, emoji) in table) {
    if (keys.any(l.contains)) return emoji;
  }
  return '🍲';
}
