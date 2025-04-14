document.addEventListener('DOMContentLoaded', () => {

    // --- Partikel Effekt Initialisierung (Kosmos/Sterne Look) ---
    particlesJS('particles-js', {
        particles: {
            number: { value: 160, density: { enable: true, value_area: 800 } }, // Mehr Sterne
            color: { value: ["#FFFFFF", "#70D6FF", "#FFDAB9"] }, // Weiß, Hellcyan, Blasses Orange (verschiedene Sterntypen)
            shape: { type: "circle" },
            opacity: { value: 0.8, random: true, anim: { enable: true, speed: 0.5, opacity_min: 0.1, sync: false } }, // Pulsierende Sterne
            size: { value: 1.5, random: true, anim: { enable: true, speed: 2, size_min: 0.3, sync: false } }, // Leicht Größenändernde Sterne
            line_linked: { enable: true, distance: 50, color: "#1a2a4a", opacity: 0.2, width: 1 }, // Sehr subtile "Konstellations"-Linien
            move: { enable: true, speed: 0.4, direction: "none", random: true, straight: false, out_mode: "out", bounce: false, attract: { enable: false, rotateX: 600, rotateY: 1200 } } // Langsame, zufällige Bewegung
        },
        interactivity: {
            detect_on: "canvas",
            events: {
                onhover: { enable: true, mode: "bubble" }, // Blasen beim Hovern (wie Gravitationslinse)
                onclick: { enable: false }, // Klick deaktiviert für ruhigeren Effekt
                resize: true
            },
            modes: {
                grab: { distance: 100, line_opacity: 0.5 },
                bubble: { distance: 120, size: 3, duration: 2, opacity: 1, speed: 3 }, // Subtilere Blasen
                repulse: { distance: 80, duration: 0.4 },
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
    const observerOptions = { root: null, rootMargin: '0px', threshold: 0.1 };
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

    // --- Easter Egg: Konami Code (Text angepasst) ---
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    let konamiIndex = 0;
    let easterEggActive = false;

    let easterEggOverlay = document.querySelector('.easter-egg-overlay');
    if (!easterEggOverlay) {
        easterEggOverlay = document.createElement('div');
        easterEggOverlay.classList.add('easter-egg-overlay');
        // Neuer Easter Egg Text
        easterEggOverlay.innerHTML = `
            <p>SIGNAL EMPFANGEN: WARP-KERN AKTIVIERT!</p>
            <p>Versteckte Sektoren des digitalen Kosmos werden nun kartiert...</p>
            <span>(Klicken, um zum Standard-Subraum zurückzukehren)</span>
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
        if (e.key.toLowerCase() === konamiCode[konamiIndex].toLowerCase()) {
            konamiIndex++;
            if (konamiIndex === konamiCode.length) {
                console.log('Konami Code Accepted! Engaging Warp Drive...'); // Konsolennachricht angepasst
                easterEggOverlay.style.display = 'flex';
                easterEggActive = true;
                konamiIndex = 0;
            }
        } else {
            if (!konamiCode.includes(e.key.toLowerCase()) || e.key.toLowerCase() !== konamiCode[0].toLowerCase()) {
                 konamiIndex = 0;
            }
        }
    });

    // Konsolen-Hinweis
    console.log("Psst... Suche nach einem alten Code, um die Navigation zu beschleunigen (↑ ↑ ↓ ↓ ← → ← → B A)");

}); // Ende DOMContentLoaded
