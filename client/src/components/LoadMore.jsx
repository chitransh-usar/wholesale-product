import { Loader2 } from "lucide-react";

const LoadMore = ({ isLoading, onClick }) => {
  return (
    <div className="w-full flex justify-center mt-8 mb-4">
      <button
        onClick={onClick}
        disabled={isLoading}
        className="flex items-center justify-center gap-2 px-6 py-2.5 border border-sage/50 text-espresso text-sm font-semibold rounded-sm hover:bg-sage/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading...
          </>
        ) : (
          "Load More Products"
        )}
      </button>
    </div>
  );
};

export default LoadMore;
