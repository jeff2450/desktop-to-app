import { Sidebar } from "../../../../components/layout/Sidebar";
import { TopBar } from "../../../../components/layout/TopBar";
import { ConversionWizard } from "../../../../components/conversion/ConversionWizard";

export default function NewConversionPage() {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 ml-60 min-h-screen">
        <TopBar title="New Conversion" />
        <div className="p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-white">Convert a web app</h2>
            <p className="text-sm text-gray-400 mt-1">
              Paste a GitHub repo URL and we'll detect the stack, transform the code, and build your installer.
            </p>
          </div>
          <ConversionWizard />
        </div>
      </div>
    </div>
  );
}
