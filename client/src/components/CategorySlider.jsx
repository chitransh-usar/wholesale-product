const CategorySlider = ({
  categories = [],
  selectedCategory,
  onSelectCategory,
}) => {
  const allCategories = ["All Products", ...categories];

  return (
    <div className="w-full overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] scrollbar-none pb-2">
      <div className="flex gap-3">
        {allCategories.map((category) => {
          const isAll = category === "All Products";
          const isActive = isAll
            ? !selectedCategory
            : selectedCategory === category;

          return (
            <button
              key={category}
              onClick={() => onSelectCategory(isAll ? null : category)}
              className={`whitespace-nowrap px-5 py-2 rounded-full text-sm font-medium transition-all duration-300 cursor-pointer ${
                isActive
                  ? "bg-clay text-cream shadow-md shadow-clay/20"
                  : "bg-sage/10 text-espresso hover:bg-sage/30 hover:shadow-sm"
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CategorySlider;
