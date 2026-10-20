/**
 * Handles toggling the main navigation menu for small screens.
 */
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

	$.fn.smallMenu = function() {
		$masthead.find( '.site-navigation' ).removeClass( 'main-navigation' ).addClass( 'main-small-navigation' );
		$masthead.find( '.site-navigation h1' ).removeClass( 'assistive-text' ).addClass( 'menu-toggle' );

		$( '.menu-toggle' ).unbind( 'click' ).click( function() {
			$masthead.find( '.menu' ).toggle();
			$( this ).toggleClass( 'toggled-on' );
		} );
	};

	// Check viewport width on first load.
	if ( $( window ).width() < 600 )
		$.fn.smallMenu();

	// Check viewport width when user resizes the browser window.
	$( window ).resize( function() {
		var browserWidth = $( window ).width();

		if ( false !== timeout )
			clearTimeout( timeout );

		timeout = setTimeout( function() {
			if ( browserWidth < 600 ) {
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