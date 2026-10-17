/// Weekly opening hours as the API sends them (`openingHours`, Docs/24):
/// `{ "mon": [{"open": "08:00", "close": "14:00"}, ...], "tue": [...], ... }` in Dakar time
/// (UTC+0). A missing day means closed that day; a null value means the restaurant never set them.
class OpeningSlot {
  const OpeningSlot(this.open, this.close);

  /// Minutes since midnight. [close] may be after midnight (e.g. 02:00 = 26 * 60) for late slots.
  final int open;
  final int close;

  static int? _minutes(Object? raw) {
    final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch('${raw ?? ''}'.trim());
    if (m == null) return null;
    final h = int.parse(m.group(1)!);
    final min = int.parse(m.group(2)!);
    if (h > 24 || min > 59) return null;
    return h * 60 + min;
  }

  static OpeningSlot? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final open = _minutes(raw['open']);
    var close = _minutes(raw['close']);
    if (open == null || close == null) return null;
    if (close <= open) close += 24 * 60; // closes after midnight
    return OpeningSlot(open, close);
  }

  static String hhmm(int minutes) {
    final m = minutes % (24 * 60);
    return '${(m ~/ 60).toString().padLeft(2, '0')}:${(m % 60).toString().padLeft(2, '0')}';
  }

  String get label => '${hhmm(open)} – ${hhmm(close)}';
}

class OpeningHours {
  const OpeningHours(this.days);

  /// Keyed by 1 (Monday) .. 7 (Sunday), like [DateTime.weekday].
  final Map<int, List<OpeningSlot>> days;

  static const List<String> keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  static const List<String> frenchDays = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  /// Null when the value is missing or unusable.
  static OpeningHours? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final days = <int, List<OpeningSlot>>{};
    for (var i = 0; i < keys.length; i++) {
      final list = raw[keys[i]];
      if (list is! List) continue;
      final slots = list.map(OpeningSlot.fromJson).whereType<OpeningSlot>().toList()..sort((a, b) => a.open.compareTo(b.open));
      if (slots.isNotEmpty) days[i + 1] = slots;
    }
    return OpeningHours(days);
  }

  List<OpeningSlot> slotsOn(int weekday) => days[weekday] ?? const [];

  /// "Ouvert jusqu'à 22:00", "Ouvre à 18:00", "Fermé aujourd'hui"... for [now] (local = Dakar time).
  String statusAt(DateTime now) {
    final minute = now.hour * 60 + now.minute;
    // A slot of yesterday that runs past midnight.
    final yesterday = now.weekday == 1 ? 7 : now.weekday - 1;
    for (final s in slotsOn(yesterday)) {
      if (s.close > 24 * 60 && minute < s.close - 24 * 60) return 'Ouvert jusqu\'à ${OpeningSlot.hhmm(s.close)}';
    }
    final today = slotsOn(now.weekday);
    for (final s in today) {
      if (minute >= s.open && minute < s.close) return 'Ouvert jusqu\'à ${OpeningSlot.hhmm(s.close)}';
    }
    for (final s in today) {
      if (minute < s.open) return 'Ouvre à ${OpeningSlot.hhmm(s.open)}';
    }
    return today.isEmpty ? 'Fermé aujourd\'hui' : 'Fermé pour aujourd\'hui';
  }
}
