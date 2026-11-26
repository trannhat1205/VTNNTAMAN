import 'package:flutter_test/flutter_test.dart';
import 'package:vtnn_tam_an_mobile/main.dart';

void main() {
  test('External link routing rules open Zalo, tel, mailto, and PDF/XLSX externally', () {
    expect(shouldOpenExternally(Uri.parse('https://zalo.me/0912345678')), isTrue);
    expect(shouldOpenExternally(Uri.parse('tel:0393120246')), isTrue);
    expect(shouldOpenExternally(Uri.parse('mailto:trannhat1205@gmail.com')), isTrue);
    expect(
      shouldOpenExternally(Uri.parse('https://vtnntaman.com/files/report.pdf')),
      isTrue,
    );
    expect(shouldOpenExternally(Uri.parse('https://vtnntaman.com/')), isFalse);
  });
}
