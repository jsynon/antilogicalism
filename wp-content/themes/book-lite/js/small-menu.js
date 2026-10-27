/**
 * Handles toggling the main navigation menu for small screens.
 */
/**
 * Applies the saved Antilogicalism color theme before the menu UI is initialized.
 * The saved value is browser-local; a first visit keeps the existing light theme.
 */
(function() {
	var storageKey = 'antilogicalism-theme';
	var theme = 'light';

	try {
		theme = window.localStorage.getItem( storageKey ) === 'dark' ? 'dark' : 'light';
	} catch ( error ) {
		// Keep the site usable when browser storage is unavailable.
	}

	document.documentElement.setAttribute( 'data-theme', theme );

	window.antilogicalismSetTheme = function( nextTheme ) {
		var next = nextTheme === 'dark' ? 'dark' : 'light';
		document.documentElement.setAttribute( 'data-theme', next );

		try {
			window.localStorage.setItem( storageKey, next );
		} catch ( error ) {
			// The current page still changes even if the preference cannot be saved.
		}
	};
})();

jQuery( document ).ready( function( $ ) {
	var $primaryMenu = $( '#menu-primary' );
	if ( ! $primaryMenu.length )
		$primaryMenu = $( '.site-navigation .menu' ).first();

	if ( $primaryMenu.length ) {
		var companionPath = '/antilogicalism/reading-companion/';
		var $companionLink = $primaryMenu.find( 'a[href="' + companionPath + '"]' );
		var $companionItem = $companionLink.closest( 'li' );

		if ( ! $companionItem.length ) {
			$companionItem = $( '<li>', {
				'class': 'menu-item menu-item-type-custom menu-item-object-custom menu-item-reading-companion'
			} );
			$companionLink = $( '<a>', {
				href: companionPath,
				text: 'Reading Companion'
			} );
			$companionItem.append( $companionLink );

			var $librarySearchItem = $primaryMenu.find( 'a[href="/antilogicalism/digital-library/"]' ).closest( 'li' );
			if ( $librarySearchItem.length )
				$librarySearchItem.after( $companionItem );
			else
				$primaryMenu.append( $companionItem );
		}

		if ( window.location.pathname.replace( /\/+$/, '/' ) === companionPath ) {
			$primaryMenu.children( '.current-menu-item, .current_page_item' )
				.removeClass( 'current-menu-item current_page_item page_item' );
			$primaryMenu.find( 'a[aria-current="page"]' ).removeAttr( 'aria-current' );
			$companionItem.addClass( 'current-menu-item page_item current_page_item' );
			$companionLink.attr( 'aria-current', 'page' );
		}
	}
	var $masthead = $( '#masthead' ),
	    timeout = false;

	// Provider share iframes can retain light pixels at their edges in dark
	// mode. Use first-party links there, while restoring the original widgets
	// in light mode. Add utility icons as inline SVGs so no remote icon font is
	// needed for Email or Print.
	function syncDarkShareButtons() {
		var isDark = document.documentElement.getAttribute( 'data-theme' ) === 'dark';

		$( '.sd-sharing li.share-facebook' ).each( function() {
			var $item = $( this ),
			    $darkLink = $item.children( '.site-dark-facebook-share' ),
			    $widget = $item.children( '.fb-share-button' );

			if ( ! isDark ) {
				$darkLink.remove();
				$widget.removeAttr( 'aria-hidden tabindex' ).show();
				return;
			}

			var url = $widget.attr( 'data-href' ) || window.location.href,
			    intent = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent( url );

			if ( ! $darkLink.length ) {
				$darkLink = $( '<a>', {
					'class': 'site-dark-facebook-share',
					'href': intent,
					'target': '_blank',
					'rel': 'noopener noreferrer',
					'aria-label': 'Share this page on Facebook'
				} ).html( '<svg class="site-share-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.2 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5h1.7V3.6c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v1.9h-3V13h3v8z"></path></svg><span>Share</span>' );
				$item.append( $darkLink );
			} else {
				$darkLink.attr( 'href', intent );
			}

			$widget.attr( 'aria-hidden', 'true' ).attr( 'tabindex', '-1' ).hide();
			$darkLink.show();
		} );

		$( '.sd-sharing li.share-email > a, .sd-sharing li.share-print > a' ).each( function() {
			var $link = $( this );
			if ( $link.children( '.site-share-icon' ).length )
				return;

			var icon = $link.closest( 'li' ).hasClass( 'share-email' )
				? '<svg class="site-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>'
				: '<svg class="site-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9V3h12v6"></path><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="7"></rect><path d="M18 12h.01"></path></svg>';
			$link.prepend( icon );
		} );

		$( '.sd-sharing li.share-twitter' ).each( function() {
			var $item = $( this ),
			    $darkLink = $item.children( '.site-dark-x-share' ),
			    $frame = $item.children( 'iframe' ),
			    $originalLink = $item.children( 'a.twitter-share-button' );

			if ( ! isDark ) {
				$darkLink.remove();
				$item.children( 'iframe, a.twitter-share-button' )
					.removeAttr( 'aria-hidden tabindex' )
					.show();
				return;
			}

			var url = $frame.attr( 'data-url' ) || $originalLink.attr( 'data-url' ) || window.location.href,
			    text = $originalLink.attr( 'data-text' ) || '',
			    via = $originalLink.attr( 'data-via' ) || 'antilogicalism';

			if ( ! text && $frame.attr( 'src' ) ) {
				try {
					var frameParams = new URLSearchParams( $frame.attr( 'src' ).split( '#' )[1] || '' );
					text = frameParams.get( 'text' ) || '';
					via = frameParams.get( 'via' ) || via;
				} catch ( error ) {
					// Sharing still works with the page URL if frame data is malformed.
				}
			}

			var intent = 'https://twitter.com/intent/tweet?url=' + encodeURIComponent( url ) +
				'&text=' + encodeURIComponent( text ) +
				'&via=' + encodeURIComponent( via );

			if ( ! $darkLink.length ) {
				$darkLink = $( '<a>', {
					'class': 'site-dark-x-share',
					'href': intent,
					'target': '_blank',
					'rel': 'noopener noreferrer',
					'aria-label': 'Share this page on X',
					'text': '𝕏 Post'
				} );
				$item.append( $darkLink );
			} else {
				$darkLink.attr( 'href', intent );
			}

			$item.children( 'iframe, a.twitter-share-button' )
				.attr( 'aria-hidden', 'true' )
				.attr( 'tabindex', '-1' )
				.hide();
			$darkLink.show();
		} );
	}

	syncDarkShareButtons();
	if ( window.MutationObserver ) {
		var shareObserver = new MutationObserver( syncDarkShareButtons );
		$( '.sd-sharing' ).each( function() {
			shareObserver.observe( this, { childList: true, subtree: true } );
		} );
	}


	// Keep the theme control separate from the page links and visible beside
	// the mobile menu heading, even while the collapsed menu is closed.
	var $siteNavigation = $masthead.find( '.site-navigation' ).first();
	if ( $siteNavigation.length && ! $siteNavigation.find( '.site-theme-toggle' ).length ) {
		var moonIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.2 15.5A8.5 8.5 0 0 1 8.5 3.8a.5.5 0 0 0-.7-.5A9 9 0 1 0 20.7 16.2a.5.5 0 0 0-.5-.7Z"></path></svg>';
		var sunIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg>';
		var $themeButton = $( '<button>', {
			type: 'button',
			'class': 'site-theme-toggle',
			'aria-label': 'Dark mode',
			'aria-pressed': document.documentElement.getAttribute( 'data-theme' ) === 'dark' ? 'true' : 'false',
			title: 'Dark mode'
		} );

		function updateThemeButton() {
			var isDark = document.documentElement.getAttribute( 'data-theme' ) === 'dark';
			$themeButton.attr( 'aria-pressed', isDark ? 'true' : 'false' );
			$themeButton.attr( 'title', isDark ? 'Dark mode on' : 'Dark mode off' );
			$themeButton.html( ( isDark ? sunIcon : moonIcon ) + '<span class="site-theme-label">' + ( isDark ? 'Light mode' : 'Dark mode' ) + '</span>' );
		}

		updateThemeButton();
		$siteNavigation.append( $themeButton );
		$themeButton.on( 'click', function() {
			var isDark = document.documentElement.getAttribute( 'data-theme' ) === 'dark';
			window.antilogicalismSetTheme( isDark ? 'light' : 'dark' );
			updateThemeButton();
			syncDarkShareButtons();
		} );
	}


	$.fn.smallMenu = function() {
		$masthead.find( '.site-navigation' ).removeClass( 'main-navigation' ).addClass( 'main-small-navigation' );
		$masthead.find( '.site-navigation h1' ).removeClass( 'assistive-text' ).addClass( 'menu-toggle' );

		$( '.menu-toggle' ).unbind( 'click' ).click( function() {
			$masthead.find( '.menu' ).toggle();
			$( this ).toggleClass( 'toggled-on' );
		} );
	};

	// Check viewport width on first load.
	if ( $( window ).width() <= 818.375 )
		$.fn.smallMenu();

	// Check viewport width when user resizes the browser window.
	$( window ).resize( function() {
		var browserWidth = $( window ).width();

		if ( false !== timeout )
			clearTimeout( timeout );

		timeout = setTimeout( function() {
			if ( browserWidth <= 818.375 ) {
				$.fn.smallMenu();
			} else {
				$masthead.find( '.site-navigation' ).removeClass( 'main-small-navigation' ).addClass( 'main-navigation' );
				$masthead.find( '.site-navigation h1' ).removeClass( 'menu-toggle' ).addClass( 'assistive-text' );
				$masthead.find( '.menu' ).removeAttr( 'style' );
			}
		}, 200 );
	} );

	var container = $( '.site-navigation' );

	// Fix child menus for touch devices.
	function fixMenuTouchTaps( container ) {
		var touchStartFn,
		    parentLink = container.find( '.menu-item-has-children > a, .page_item_has_children > a' );

		if ( 'ontouchstart' in window ) {
			touchStartFn = function( e ) {
				var menuItem = this.parentNode;

				if ( ! menuItem.classList.contains( 'focus' ) ) {
					e.preventDefault();
					for( var i = 0; i < menuItem.parentNode.children.length; ++i ) {
						if ( menuItem === menuItem.parentNode.children[i] ) {
							continue;
						}
						menuItem.parentNode.children[i].classList.remove( 'focus' );
					}
					menuItem.classList.add( 'focus' );
				} else {
					menuItem.classList.remove( 'focus' );
				}
			};

			for ( var i = 0; i < parentLink.length; ++i ) {
				parentLink[i].addEventListener( 'touchstart', touchStartFn, false )
			}
		}
	}

	fixMenuTouchTaps( container );
} );
