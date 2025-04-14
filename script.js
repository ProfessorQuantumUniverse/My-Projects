document.addEventListener('DOMContentLoaded', () => {

    // --- Partikel Effekt Initialisierung ---
    particlesJS('particles-js', {
        particles: {
            number: { value: 80, density: { enable: true, value_area: 800 } },
            color: { value: "#ffffff" }, // Farbe der Partikel
            shape: { type: "circle", stroke: { width: 0, color: "#000000" }, polygon: { nb_sides: 5 }, image: { src: "img/github.svg", width: 100, height: 100 } },
            opacity: { value: 0.5, random: false, anim: { enable: false, speed: 1, opacity_min: 0.1, sync: false } },
            size: { value: 3, random: true, anim: { enable: false, speed: 40, size_min: 0.1, sync: false } },
            line_linked: { enable: true, distance: 150, color: "#ffffff", opacity: 0.4, width: 1 }, // Linien zwischen Partikeln
            move: { enable: true, speed: 3, direction: "none", random: false, straight: false, out_mode: "out", bounce: false, attract: { enable: false, rotateX: 600, rotateY: 1200 } }
        },
        interactivity: {
            detect_on: "canvas",
            events: {
                onhover: { enable: true, mode: "repulse" }, // Partikel weichen Maus aus
                onclick: { enable: true, mode: "push" }, // Partikel wegstoßen bei Klick
                resize: true
            },
            modes: {
                grab: { distance: 400, line_opacity: 1 },
                bubble: { distance: 400, size: 40, duration: 2, opacity: 8, speed: 3 },
                repulse: { distance: 100, duration: 0.4 }, // Distanz für Maus-Ausweicheffekt
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

    // --- Fade-In Effekt beim Scrollen ---
    const observerOptions = {
        root: null, // beobachtet im Viewport
        rootMargin: '0px',
        threshold: 0.1 // Element ist zu 10% sichtbar
    };

    const observerCallback = (entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target); // Stoppt Beobachtung nach erster Sichtbarkeit
            }
        });
    };

    const scrollObserver = new IntersectionObserver(observerCallback, observerOptions);
    const fadeElements = document.querySelectorAll('.fade-in-scroll');
    fadeElements.forEach(el => scrollObserver.observe(el));


    // --- Easter Egg: Konami Code ---
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let konamiIndex = 0;
    let easterEggActive = false; // Verhindert Mehrfachauslösung

    const easterEggOverlay = document.createElement('div');
    easterEggOverlay.classList.add('easter-egg-overlay');
    easterEggOverlay.innerHTML = `
        <p>EASTER EGG ACTIVATED!</p>
        <p>Du hast den Code geknackt!</p>
        <span>(Klicke hier zum Schließen)</span>
    `;
    document.body.appendChild(easterEggOverlay);

    // Event Listener zum Schließen des Overlays
    easterEggOverlay.addEventListener('click', () => {
        easterEggOverlay.style.display = 'none';
        konamiIndex = 0; // Reset Code
        easterEggActive = false;
    });

    document.addEventListener('keydown', (e) => {
        if (easterEggActive) return; // Wenn schon aktiv, nichts tun

        if (e.key === konamiCode[konamiIndex]) {
            konamiIndex++;
            if (konamiIndex === konamiCode.length) {
                console.log('Konami Code Activated!');
                easterEggOverlay.style.display = 'flex'; // Zeige das Overlay
                easterEggActive = true; // Markiere als aktiv
                konamiIndex = 0; // Reset für evtl. erneute Eingabe nach Schließen
            }
        } else {
            konamiIndex = 0; // Falsche Taste, Sequenz zurücksetzen
        }
    });

    // Kleiner Konsolen-Hinweis für Entwickler ;)
    console.log("Psst... Entwickler! Versuch mal den Konami-Code auf deiner Tastatur 😉");
    console.log("Oder schau dir den Quellcode für mehr an.");

}); // Ende DOMContentLoaded
