using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace StockDesktop
{
    public partial class MainWindow : Window
    {
        private static readonly HttpClient clienteHttp = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        private Process _procesoNode;

        public MainWindow()
        {
            InitializeComponent();
            _ = InicializarAplicacionAsync();
        }

        private async Task InicializarAplicacionAsync()
        {
            try
            {
                // 1. Lanzar el servidor Node.js como proceso hijo
                IniciarServidorNode();

                // 2. Esperar a que el servidor Node.js responda en localhost:3000
                bool servidorListo = await EsperarServidorNodeAsync("http://localhost:3000/api/status");

                if (!servidorListo)
                {
                    MessageBox.Show(
                        "No se pudo establecer conexión con el servidor Node.js (http://localhost:3000).\n\n" +
                        "Revisa la ventana de consola de Node (si aparece) para ver el error real, " +
                        "o corre 'npm start' manualmente dentro de node-crud para diagnosticar.",
                        "Error de Conexión",
                        MessageBoxButton.OK,
                        MessageBoxImage.Error
                    );
                    return;
                }

                // 3. Inicializar entorno WebView2
                await webView.EnsureCoreWebView2Async(null);

                // 4. Capturar logs de la consola Web para depurar en Visual Studio
                webView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
                webView.CoreWebView2.DOMContentLoaded += CoreWebView2_DOMContentLoaded;

                // 5. Mapear carpeta local wwwroot como Host Virtual seguro (HTTPS)
                string wwwrootPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "wwwroot");

                if (!Directory.Exists(wwwrootPath))
                {
                    MessageBox.Show(
                        $"No se encontró la carpeta 'wwwroot' en:\n{wwwrootPath}",
                        "Carpeta Faltante",
                        MessageBoxButton.OK,
                        MessageBoxImage.Warning
                    );
                    return;
                }

                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "stockupt.app",
                    wwwrootPath,
                    CoreWebView2HostResourceAccessKind.Allow
                );

                // 6. Navegar a la página de Login
                webView.CoreWebView2.Navigate("https://stockupt.app/login.html");
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Error crítico al inicializar WebView2:\n{ex.Message}",
                    "Excepción",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error
                );
            }
        }

        /// <summary>
        /// Lanza 'npm start' dentro de node-crud como proceso hijo de esta app.
        /// </summary>
        private void IniciarServidorNode()
        {
            try
            {
                string rutaBase = AppDomain.CurrentDomain.BaseDirectory;
                string rutaNodeCrud = Path.Combine(rutaBase, "node-crud");

                if (!Directory.Exists(rutaNodeCrud))
                {
                    string dir = rutaBase;
                    for (int i = 0; i < 8 && dir != null; i++)
                    {
                        string candidato = Path.Combine(dir, "node-crud");
                        if (Directory.Exists(candidato))
                        {
                            rutaNodeCrud = candidato;
                            break;
                        }
                        dir = Directory.GetParent(dir)?.FullName;
                    }
                }

                if (!Directory.Exists(rutaNodeCrud))
                {
                    MessageBox.Show(
                        "No se encontró la carpeta 'node-crud'.\n\n" +
                        $"Se empezó a buscar desde:\n{rutaBase}\n\n" +
                        "Verifica que node-crud exista en la carpeta del proyecto, a un nivel " +
                        "razonable de distancia de la carpeta de salida (bin\\Debug\\...).",
                        "node-crud no encontrado",
                        MessageBoxButton.OK,
                        MessageBoxImage.Warning
                    );
                    return;
                }

                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/k npm start",
                    WorkingDirectory = rutaNodeCrud,
                    UseShellExecute = true,
                    CreateNoWindow = false
                };

                _procesoNode = Process.Start(psi);

                if (_procesoNode == null)
                {
                    MessageBox.Show(
                        "Process.Start devolvió null al intentar lanzar cmd.exe / npm start.",
                        "No se pudo lanzar Node.js",
                        MessageBoxButton.OK,
                        MessageBoxImage.Warning
                    );
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    $"Excepción al intentar lanzar Node.js:\n\n{ex.GetType().Name}: {ex.Message}",
                    "Error en IniciarServidorNode",
                    MessageBoxButton.OK,
                    MessageBoxImage.Error
                );
            }
        }

        /// <summary>
        /// Comprueba si el servidor Node.js está respondiendo antes de cargar la interfaz.
        /// Node puede tardar unos segundos en levantar y conectar a SQL Server,
        /// por eso reintentamos varias veces antes de darnos por vencidos.
        /// </summary>
        private async Task<bool> EsperarServidorNodeAsync(string urlStatus)
        {
            int reintentosMaximos = 20; // 20 x 1s = hasta 20 segundos de margen

            for (int i = 0; i < reintentosMaximos; i++)
            {
                try
                {
                    HttpResponseMessage respuesta = await clienteHttp.GetAsync(urlStatus);
                    if (respuesta.IsSuccessStatusCode)
                    {
                        return true;
                    }
                }
                catch
                {
                    // El servidor aún está iniciando, reintentar en 1 segundo
                }

                await Task.Delay(1000);
            }

            return false;
        }

        /// <summary>
        /// Captura errores de script de la interfaz para depuración.
        /// </summary>
        private async void CoreWebView2_DOMContentLoaded(object sender, CoreWebView2DOMContentLoadedEventArgs e)
        {
            string scriptInyeccion = @"
                console.error = (function(oldError) {
                    return function(...args) {
                        oldError.apply(console, args);
                        window.chrome.webview.postMessage('CONSOLE_ERROR: ' + args.join(' '));
                    };
                })(console.error);
            ";
            await webView.CoreWebView2.ExecuteScriptAsync(scriptInyeccion);
        }

        private void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string mensaje = e.TryGetWebMessageAsString();
            Debug.WriteLine($"[WebView2 JS]: {mensaje}");
        }

        protected override void OnClosed(EventArgs e)
        {
            base.OnClosed(e);
            try
            {
                if (_procesoNode != null && !_procesoNode.HasExited)
                {
                    // Mata el árbol de procesos (cmd.exe + node.exe hijo)
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "taskkill",
                        Arguments = $"/PID {_procesoNode.Id} /T /F",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    });
                }
            }
            catch
            {
                // Si ya se cerró o no se pudo matar, no pasa nada grave.
            }
        }
    }
}