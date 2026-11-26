// ============================================================================
// VTNN TÂM AN — ỨNG DỤNG DI ĐỘNG ANDROID & iOS ĐỒNG BỘ 100% THỜI GIAN THỰC
// Kết nối trực tiếp hệ thống live https://vtnntaman.com/ (Firebase RTDB,
// Firestore, Storage, Kiểm kê kho KK, FEFO, Tuổi nợ & Nhắc Zalo, In nhiệt
// K58/K80, Quét mã vạch Camera, Chat nội bộ giống Zalo & Trợ lý A.I).
// ============================================================================

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

const String kVtnnProductionUrl = 'https://vtnntaman.com/';
const Color kBrandEmerald = Color(0xFF047857);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: kBrandEmerald,
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
    ),
  );
  runApp(const VtnnTamAnMobileApp());
}

class VtnnTamAnMobileApp extends StatelessWidget {
  const VtnnTamAnMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'VTNN Tâm An',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: kBrandEmerald,
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: Colors.white,
      ),
      home: const VtnnLiveShellScreen(),
    );
  }
}

bool shouldOpenExternally(Uri uri) {
  final scheme = uri.scheme.toLowerCase();
  if (scheme == 'tel' ||
      scheme == 'mailto' ||
      scheme == 'sms' ||
      scheme == 'zalo') {
    return true;
  }
  final host = uri.host.toLowerCase();
  if (host.contains('zalo.me') ||
      host.contains('aistudio.google.com') ||
      (host.contains('google.com') && uri.path.startsWith('/search')) ||
      host.contains('firebasestorage.googleapis.com')) {
    return true;
  }
  final pathLower = uri.path.toLowerCase();
  if (pathLower.endsWith('.pdf') || pathLower.endsWith('.xlsx')) {
    return true;
  }
  return false;
}

class VtnnLiveShellScreen extends StatefulWidget {
  const VtnnLiveShellScreen({super.key});

  @override
  State<VtnnLiveShellScreen> createState() => _VtnnLiveShellScreenState();
}

class _VtnnLiveShellScreenState extends State<VtnnLiveShellScreen> {
  late final WebViewController _controller;
  int _loadingProgress = 0;
  bool _hasLoadedInitialPage = false;
  bool _hasNetworkError = false;
  String? _errorDescription;

  @override
  void initState() {
    super.initState();

    late final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }

    final controller = WebViewController.fromPlatformCreationParams(params);
    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (!mounted) return;
            setState(() {
              _loadingProgress = progress;
            });
          },
          onPageStarted: (_) {
            if (!mounted) return;
            setState(() {
              _hasNetworkError = false;
              _errorDescription = null;
            });
          },
          onPageFinished: (_) {
            if (!mounted) return;
            setState(() {
              _hasLoadedInitialPage = true;
              _loadingProgress = 100;
            });
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame == true && mounted) {
              setState(() {
                _hasNetworkError = true;
                _errorDescription = error.description;
                _hasLoadedInitialPage = true;
              });
            }
          },
          onNavigationRequest: (request) async {
            final uri = Uri.tryParse(request.url);
            if (uri != null && shouldOpenExternally(uri)) {
              await _launchExternal(uri);
              return NavigationDecision.prevent;
            }
            return NavigationDecision.navigate;
          },
        ),
      )
      ..loadRequest(Uri.parse(kVtnnProductionUrl));

    if (controller.platform is AndroidWebViewController) {
      final androidController = controller.platform as AndroidWebViewController;
      androidController.setMediaPlaybackRequiresUserGesture(false);
      androidController.setOnPlatformPermissionRequest((request) {
        request.grant();
      });
    }

    _controller = controller;
  }

  Future<void> _launchExternal(Uri uri) async {
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // Ignore if device has no handler for scheme
    }
  }

  Future<void> _reloadApp() async {
    setState(() {
      _hasNetworkError = false;
      _errorDescription = null;
      _loadingProgress = 10;
    });
    await _controller.loadRequest(Uri.parse(kVtnnProductionUrl));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
          return;
        }
        if (!context.mounted) return;
        final shouldExit = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Thoát VTNN Tâm An?'),
            content: const Text(
                'Bạn có muốn đóng ứng dụng quản lý bán hàng VTNN Tâm An không?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(false),
                child: const Text('Ở lại'),
              ),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: kBrandEmerald),
                onPressed: () => Navigator.of(ctx).pop(true),
                child: const Text('Thoát'),
              ),
            ],
          ),
        );
        if (shouldExit == true) {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              if (_hasNetworkError)
                _buildOfflineView()
              else
                WebViewWidget(controller: _controller),

              // Top slim loading progress bar
              if (_loadingProgress > 0 &&
                  _loadingProgress < 100 &&
                  !_hasNetworkError)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: LinearProgressIndicator(
                    value: _loadingProgress / 100.0,
                    minHeight: 3,
                    backgroundColor: const Color(0xFFD1FAE5),
                    valueColor:
                        const AlwaysStoppedAnimation<Color>(kBrandEmerald),
                  ),
                ),

              // Branded Splash Screen while initial web app loads
              if (!_hasLoadedInitialPage) _buildSplashOverlay(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSplashOverlay() {
    return Container(
      color: Colors.white,
      width: double.infinity,
      height: double.infinity,
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 140,
            height: 140,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: const Color(0xFFA7F3D0), width: 2),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x18047857),
                  blurRadius: 24,
                  offset: Offset(0, 10),
                ),
              ],
            ),
            child: Image.asset('assets/logo_tam_an.png', fit: BoxFit.contain),
          ),
          const SizedBox(height: 20),
          const Text(
            'VTNN TÂM AN',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: Color(0xFF065F46),
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Vật tư Tâm An — Nhà Nông an tâm',
            style: TextStyle(fontSize: 13, color: Color(0xFF475569)),
          ),
          const SizedBox(height: 28),
          const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 3,
              color: kBrandEmerald,
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Đang kết nối hệ thống kho thời gian thực...',
            style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
          ),
        ],
      ),
    );
  }

  Widget _buildOfflineView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Image.asset('assets/logo_tam_an.png', width: 112, height: 112),
            const SizedBox(height: 18),
            const Text(
              'Không thể kết nối máy chủ VTNN Tâm An',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.bold,
                color: Color(0xFF0F172A),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _errorDescription?.isNotEmpty == true
                  ? 'Chi tiết: $_errorDescription'
                  : 'Vui lòng kiểm tra Wi-Fi hoặc 4G/5G trên điện thoại rồi thử lại.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 22),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: kBrandEmerald,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: _reloadApp,
                icon: const Icon(Icons.refresh),
                label: const Text('Thử kết nối lại'),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: kBrandEmerald,
                  side: const BorderSide(color: kBrandEmerald),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
                onPressed: () => _launchExternal(Uri.parse(kVtnnProductionUrl)),
                icon: const Icon(Icons.open_in_browser),
                label: const Text('Mở trên trình duyệt Chrome / Safari'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
