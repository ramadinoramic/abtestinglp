export default function GeoBlockedPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="text-5xl mb-6">🇨🇭</div>
        <h1 className="text-2xl font-bold text-white mb-3">
          Nur in der Schweiz verfügbar
        </h1>
        <p className="text-gray-400 mb-2">
          Dieses Angebot ist ausschliesslich für Nutzer in der Schweiz bestimmt.
        </p>
        <p className="text-gray-500 text-sm mt-6 border-t border-gray-800 pt-6">
          This offer is only available to users located in Switzerland.<br />
          If you believe this is an error, please try again later.
        </p>
      </div>
    </div>
  );
}
