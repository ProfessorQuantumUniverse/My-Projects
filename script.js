document.addEventListener('DOMContentLoaded', () => {

    // --- Partikel Effekt Initialisierung (Wissenschaftlicher Look) ---
    particlesJS('particles-js', {
        particles: {
            number: { value: 100, density: { enable: true, value_area: 1000 } }, // Mehr, aber weniger dicht
            color: { value: "#88CCEE" }, // Heller Blauton für Partikel
            shape: { type: "circle", stroke: { width: 0, color: "#000000" }, polygon: { nb_sides: 5 } },
            opacity: { value: 0.4, random: true, anim: { enable: false, speed: 1, opacity_min: 0.1, sync: false } }, // Leichte Zufallsopazität
            size: { value: 2.5, random: true, anim: { enable: false, speed: 40, size_min: 0.5, sync: false } }, // Kleinere Partikel
            line_linked: { enable: true, distance: 120, color: "#3A506B", opacity: 0.25, width: 1 }, // Subtilere Linien in Mittelblau
            move: { enable: true, speed: 1.5, direction: "none", random: false, straight: false, out_mode: "out", bounce: false, attract: { enable: false, rotateX: 600, rotateY: 1200 } } // Langsamere Bewegung
        },
        interactivity: {
            detect_on: "canvas",
            events: {
                onhover: { enable: true, mode: "bubble" }, // Blasen statt Wegstoßen
                onclick: { enable: true, mode: "push" },
                resize: true
            },
            modes: {
                grab: { distance: 200, line_opacity: 0.5 },
                bubble: { distance: 150, size: 4, duration: 2, opacity: 0.8, speed: 3 }, // Kleinere Blasen
                repulse: { distance: 100, duration: 0.4 },
                push: { particles_nb: 4 },
                remove: { particles_nb: 2 }
            }
        },
        retina_detect: true
    });


    // --- Footer Jahr aktualisieren ---
    const currentYear = new Date().getFullYear();
    const yearElement = document.getElementById('current-year');
    if (yearElement) {
        yearElement.textContent = currentYear;
    }

    // --- Fade-In Effekt beim Scrollen (unverändert) ---
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };
    const observerCallback = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    };
    const scrollObserver = new IntersectionObserver(observerCallback, observerOptions);
    const fadeElements = document.querySelectorAll('.fade-in-scroll');
    fadeElements.forEach(el => scrollObserver.observe(el));

    // --- Easter Egg: Konami Code (unverändert) ---
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let konamiIndex = 0;
    let easterEggActive = false;

    // Nur erstellen, wenn nicht schon vorhanden (falls Skript mehrmals läuft)
    let easterEggOverlay = document.querySelector('.easter-egg-overlay');
    if (!easterEggOverlay) {
        easterEggOverlay = document.createElement('div');
        easterEggOverlay.classList.add('easter-egg-overlay');
        easterEggOverlay.innerHTML = `
            <p>SYSTEMPROTOKOLL 42: EASTER EGG INITIALISIERT</p>
            <p>Zugangscode akzeptiert. Willkommen im Systemkern.</p>
            <span>(Klicken zum Dekonnektieren)</span>
        `;
        document.body.appendChild(easterEggOverlay);

        easterEggOverlay.addEventListener('click', () => {
            easterEggOverlay.style.display = 'none';
            konamiIndex = 0;
            easterEggActive = false;
        });
    }

    document.addEventListener('keydown', (e) => {
        if (easterEggActive) return;

        if (e.key.toLowerCase() === konamiCode[konamiIndex].toLowerCase()) { // Sicherstellen, dass Groß/Kleinschreibung egal ist
            konamiIndex++;
            if (konamiIndex === konamiCode.length) {
                console.log('Konami Code Activated! SYSTEMPROTOKOLL 42');
                easterEggOverlay.style.display = 'flex';
                easterEggActive = true;
                konamiIndex = 0;
            }
        } else {
             // Reset nur, wenn die Taste nicht Teil der Sequenz ist (ignoriert z.B. Shift)
            if (!konamiCode.includes(e.key)) {
                 konamiIndex = 0;
            } else if (e.key.toLowerCase() !== konamiCode[0].toLowerCase()) {
                 // Spezialfall: Wenn eine falsche Taste gedrückt wird, die aber Teil des Codes ist (z.B. Pfeil unten statt oben)
                 konamiIndex = 0;
            }

        }
    });

    // Konsolen-Hinweis
    console.log("Psst... Entwickler! Ein alter Code öffnet vielleicht versteckte Türen... (↑ ↑ ↓ ↓ ← → ← → B A)");

}); // Ende DOMContentLoaded
