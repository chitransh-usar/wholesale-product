import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import gsap from "gsap";

const InfoLayout = () => {
	const location = useLocation();
	const pageRef = useRef(null);
	useEffect(() => {
		gsap.set(window, { scrollTo: 0 });

		gsap.fromTo(
			pageRef.current,
			{
				opacity: 0,
				y: 16,
			},
			{
				opacity: 1,
				y: 0,
				duration: 0.45,
				ease: "power2.out",
				clearProps: "all",
			},
		);
	}, [location.pathname]);

	return (
		<div className="min-h-screen bg-cream text-espresso">
			<main
				ref={pageRef}
				className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-4 py-8 sm:px-6 lg:px-8"
			>
				<Outlet />
			</main>
		</div>
	);
};

export default InfoLayout;
