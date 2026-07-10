document.addEventListener('DOMContentLoaded', () => {
    const scrollObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { root: null, rootMargin: '0px', threshold: 0.1 });

    function observeFadeInElements() {
        const fadeElements = document.querySelectorAll('.fade-in-scroll');
        fadeElements.forEach(el => scrollObserver.observe(el));
    }

    async function loadProjects() {
        try {
            const response = await fetch('projects.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const projects = await response.json();
            const grid = document.querySelector('.projekt-grid');
            if (!grid) {
                console.error('Projekt-Grid nicht gefunden.');
                return;
            }

            projects.forEach(project => {
                const card = document.createElement('div');
                card.className = 'projekt-karte fade-in-scroll';

                let linksHTML = '';
                project.links.forEach(link => {
                    linksHTML += `<a href="${link.url}" target="_blank" class="projekt-button ${link.class || ''}">${link.text}<i class="${link.icon}"></i></a>`;
                });

                let tagsHTML = '';
                project.tags.forEach(tag => {
                    tagsHTML += `<span>${tag}</span>`;
                });

                card.innerHTML = `
                    <img src="${project.image}" alt="${project.imageAlt}" class="projekt-bild" loading="lazy">
                    <div class="projekt-inhalt">
                        <h3>${project.title}</h3>
                        <p>${project.description}</p>
                        <div class="projekt-tags">${tagsHTML}</div>
                        <div class="projekt-links">${linksHTML}</div>
                    </div>
                `;
                grid.appendChild(card);
            });

            // Re-initialize scroll observer for newly added elements
            observeFadeInElements();

        } catch (error) {
            console.error('Fehler beim Laden der Projekte:', error);
        }
    }

    loadProjects();
    observeFadeInElements(); // Observe existing elements on initial load

    // --- Partikel Effekt Initialisierung (Kosmos/Sterne Look) ---
    // === PARTICLES.JS INIT & CONTROLS ===

// Speichere deine Standard-Konfiguration
const particleConfig = {
    particles: {
       number: { value: 150, density: { enable: true, value_area: 1200 } }, // Startwert
       color: { value: ["#8b949e", "#58a6ff", "#c9d1d9", "#bc8cff"] },
       shape: { type: "circle" },
       opacity: { value: 0.6, random: true, anim: { enable: true, speed: 0.4, opacity_min: 0.1, sync: false } },
       size: { value: 1.5, random: true, anim: { enable: false } },
       line_linked: { enable: true, distance: 50, color: "#30363d", opacity: 0.15, width: 1 }, // Startwert
       move: { enable: true, speed: 0.3, direction: "none", random: true, straight: false, out_mode: "out", attract: { enable: false } }
    },
    interactivity: {
       detect_on: "canvas",
       events: { onhover: { enable: true, mode: "bubble" }, onclick: { enable: false } },
       modes: { bubble: { distance: 100, size: 2.5, duration: 2, opacity: 1 } }
    },
    retina_detect: true
};

// Funktion zum Initialisieren (oder Re-Initialisieren)
function initParticles(config) {
   // Überprüfen, ob bereits eine Instanz existiert und diese zerstören
   if (window.pJSDom && window.pJSDom.length > 0) {
       window.pJSDom[0].pJS.fn.vendors.destroypJS(); // Zerstört die erste Instanz
       window.pJSDom = []; // Leert das Array (wichtig!)
   }
   // Neue Instanz erstellen
   particlesJS('particles-js', config); // 'particles-js' ist die ID deines particle containers
}

// Initiale Partikel laden
initParticles(particleConfig);

// Event Listener für die Buttons
const controlsContainer = document.getElementById('background-controls');
if (controlsContainer) {
   controlsContainer.addEventListener('click', (event) => {
       if (event.target.tagName === 'BUTTON') {
           const action = event.target.dataset.action;
           let configChanged = false;

           switch (action) {
               case 'more-particles':
                   particleConfig.particles.number.value += 300; // Erhöhe Wert
                   configChanged = true;
                   break;
               case 'less-particles':
                   if (particleConfig.particles.number.value > 50) { // Mindestwert
                       particleConfig.particles.number.value -= 50;
                       configChanged = true;
                   }
                   break;
               case 'toggle-lines':
                   particleConfig.particles.line_linked.enable = !particleConfig.particles.line_linked.enable; // Umschalten
                   configChanged = true;
                   break;
           }

           // Wenn sich die Konfiguration geändert hat, neu initialisieren
           if (configChanged) {
               console.log("Re-initializing particles with config:", particleConfig);
               initParticles(particleConfig);
           }
       }
   });
}

// ... (Rest deines script.js, wie Cursor, Animationen etc.) ...

        

    // --- Footer Jahr aktualisieren ---
    const currentYear = new Date().getFullYear();
    const yearElement = document.getElementById('current-year');
    if (yearElement) {
        yearElement.textContent = currentYear;
    }

    // Custom-Cursor entfernt: der rAF-/GSAP-getriebene "kosmische" Cursor wirkte
    // träge (nachlaufender Dot) und kostete dauerhaft einen Animations-Loop.
    // --- Fade-In Effekt wird jetzt durch observeFadeInElements() gehandhabt ---

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

    window.fadeParticles = function(opacity) {
        const container = document.getElementById('particles-js');
        if (container) container.style.opacity = opacity;
        // Perf: unsichtbare Partikel wirklich PAUSIEREN — particles.js rechnet & zeichnet
        // sonst mit vollem rAF-Loop weiter, obwohl nichts zu sehen ist (Ruckel-Quelle,
        // v. a. während das 3D-Universum läuft).
        const pjs = window.pJSDom && window.pJSDom[0] && window.pJSDom[0].pJS;
        if (!pjs) return;
        if (opacity <= 0.01) {
            if (pjs.fn.drawAnimFrame) {
                cancelAnimationFrame(pjs.fn.drawAnimFrame);
                pjs.fn.drawAnimFrame = null;
            }
        } else if (!pjs.fn.drawAnimFrame) {
            pjs.fn.vendors.draw();
        }
    };

}); // Ende DOMContentLoaded

