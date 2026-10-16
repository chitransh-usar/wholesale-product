import { Outlet, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { useEffect, useRef } from "react";
import gsap from "gsap";

const MainLayout = () => {
	const location = useLocation();
	const pageRef = useRef(null);
	// Only reset scroll here. Pages animate their own content (hero, product
	// detail, result cards); fading the whole shell as well made every
	// navigation visibly flash twice.
	useEffect(() => {
		gsap.set(window, { scrollTo: 0 });
	}, [location.pathname]);

	return (
		<div className="font-dmsans min-h-screen bg-cream text-espresso flex flex-col">
			<Navbar />
			<main ref={pageRef} className="flex-1 w-full max-w-7xl mx-auto px-4 py-6">
				<Outlet />
			</main>
			<Footer />
		</div>
	);
};

export default MainLayout;
