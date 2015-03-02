
var Scoreboard = (function () {
    var board = {};

    var table_div_id = null;
    var table = null;
    var table_header = null;
    var hostname = null;

    var ci_results = null;
    var ci_accounts = [];
    var row_cache = {};

    var spinner = null;
    var overlay = null;
    var opaque_overlay = null;

    var hide_overlay = function () {
        spinner.stop();
        overlay.remove();
        opaque_overlay.remove();
    }

    var show_overlay = function () {
        overlay = $(document.createElement('div'));
        overlay.addClass('overlay_clear');
        overlay.appendTo(document.body);
        opaque_overlay = $(document.createElement('div'));
        opaque_overlay.addClass('overlay_opaque');
        opaque_overlay.appendTo(document.body);
        title = $(document.createElement('div'));
        title.addClass('overlay_title');
        title.html('Building results...');
        title.appendTo(overlay);

        var opts = {
            lines: 20, // The number of lines to draw
            length: 35, // The length of each line
            width: 10, // The line thickness
            radius: 45, // The radius of the inner circle
            corners: 1, // Corner roundness (0..1)
            rotate: 0, // The rotation offset
            direction: 1, // 1: clockwise, -1: counterclockwise
            color: '#000', // #rgb or #rrggbb or array of colors
            speed: 1, // Rounds per second
            trail: 60, // Afterglow percentage
            shadow: true, // Whether to render a shadow
            hwaccel: true, // Whether to use hardware acceleration
            className: 'spinner', // The CSS class to assign to the spinner
            zIndex: 2e9, // The z-index (defaults to 2000000000)
            top: '50%', // Top position relative to parent
            left: '50%' // Left position relative to parent
        };
        spinner = new Spinner(opts).spin();
        $(spinner.el).appendTo(overlay);

    }

    var gather_data_and_build = function () {
        show_overlay();
        $.ajax({
            type: 'get',
            url: 'query',
            data: window.location.search.substring(1),
            success: function(data) {
                ci_results = JSON.parse(data);
                build_table();
            }
        });
    };

    var ci_account_header = function (user_name, user_name_pretty) {
        return user_name_pretty + ' <br /> (' + user_name + ')';
    };

    var review_patchset_header = function (review_id, review_patchset) {
        return review_id + ',' + review_patchset;
    };

    var create_header = function () {
        td = $(document.createElement('td'));
        td.addClass('pretty_table_header');
        return td;
    };

    var create_filler = function () {
        td = $(document.createElement('td'));
        td.addClass('no_result');
        td.html('&nbsp');
        return td;
    };

    var add_column = function (header_title) {
        var td = create_header();
        td.html(header_title);
        td.appendTo(table_header);

        // fill in all other rows (except the header)
        // that wont have entries for this column
        var all_rows = table.children('tbody').children('tr:not(:first-child)');
        all_rows.each(function () {
            create_filler().appendTo($(this));
        });

    };

    var add_ci_column_if_needed = function (user_name, user_name_pretty) {
        var ci_accounts_index = ci_accounts.indexOf(user_name)
        if (ci_accounts_index == -1) {
            ci_accounts.push(user_name);
            ci_accounts_index = ci_accounts.length - 1;
            var column_header = ci_account_header(user_name, user_name_pretty);
            add_column(column_header)
        }
        return ci_accounts_index;
    };

    var set_result = function(cell, result) {
        var cell_class = null;

        switch (result) {
            case 'SUCCESS':
                cell_class = 'success';
                break;
            case 'FAILURE':
            case 'ERROR':
            case 'NOT_REGISTERED':
            case 'ABORTED':
                cell_class = 'fail';
                break;
            case 'MERGE FAILED':
            case 'UNKNOWN':
            default:
                cell_class = 'unknown';
                break;
        }

        cell.removeClass().addClass(cell_class);
        cell.html(result);
    };

    var handle_result = function(result) {
        var result_row = null;
        var ci_index = null;
        // console.log(JSON.stringify(result));
        var review_id_patchset = review_patchset_header(result.review_id, result.review_patchset);

        // see if we alredy have entries for this result
        result_row_element = row_cache[review_id_patchset];
        if (result_row_element) {
            result_row = $(result_row_element);
        }
        if (result_row) {

            // see if there is already a column for the ci account name
            // if not add one in and expand the table
            ci_index = add_ci_column_if_needed(result.user_name, result.user_name_pretty);
        }
        else {
            // add a new row for the review number + patchset
            result_row = $(document.createElement('tr'));
            result_row.appendTo(table);
            var label = create_header();
            label.html(review_id_patchset);
            label.appendTo(result_row);
            row_cache[review_id_patchset] = result_row.get();

            // fill in the new row with cells for existing columns, fill in
            // the one we know about that is for this result
            for (var j = 0; j < ci_accounts.length; j++) {
                create_filler().appendTo(result_row);
            }

            // see if there is already a column for the ci account name
            // if not add one in and expand the table
            ci_index = add_ci_column_if_needed(result.user_name, result.user_name_pretty);
        }

        // find the cell for this ci account and fill in the result
        // we'll make the cell have an onclick for the url and show
        // the url in a tooltip
        var td = result_row.children().eq(ci_index + 1);  // offset 1 for the first column
        var url = "https://review.openstack.org/#/c/" + result.review_id + "/" + result.review_patchset;
        td.on('click', (function () {
            // closures are weird.. scope the url so each on click is using
            // the right one and not just the last url handled by the loop
            var review_url = url;
            return function () {
                window.open(review_url, '_blank');
            }
        })());
        td.prop('title', url);
        set_result(td, result.result);
    }

    var build_table = function () {
        table = $(document.createElement('table'));
        table.addClass('pretty_table');
        table.attr("cellspacing", 0);
        table_container = $('#' + table_div_id);
        table_container.addClass('scoreboard_container');
        table.appendTo(table_container);

        // build a table header that will (by the time
        // we're done) have row for each ci account name
        table_header = $(document.createElement('tr'));
        create_header().appendTo(table_header); // spacer box
        table_header.appendTo(table);

        // TODO: maybe process some of this in a worker thread?
        // It might be nice if we can build a model and then render it
        // all in one go instead of modifying the DOM so much... or at
        // least do some pre-checks to build out all of the columns
        // first so we don't have to keep updating them later on
        //
        // For now we will handle a single result at a time (later on
        // we could maybe stream/pull incremental updates so the page
        // is 'live').
        //
        // This will add each result into the table and then yeild
        // the main thread so the browser can render, handle events,
        // and generally not lock up and be angry with us. It still
        // takes a while to actually build out the table, but at least
        // it will be more exciting to watch all the results pop up
        // on the screen instead of just blank page.
        var index = 0;
        var num_results = ci_results.length;
        function handle_result_wrapper() {
            if (index < num_results) {
                handle_result(ci_results[index]);
                index++;
                window.setTimeout(handle_result_wrapper, 0);
            } else {
                hide_overlay();
            }
        }
        handle_result_wrapper();

    };

    var add_input_to_form = function (form, label_text, input_name, starting_val) {
        var label = $('<label>').text(label_text + ":");
        var input = $('<input type="text">').attr({id: input_name, name: input_name});
        input.appendTo(label);
        if (starting_val) {
            input.val(starting_val);
        }
        label.appendTo(form);
        return input;
    }

    var get_param_by_name = function (name) {
        name = name.replace(/[\[]/, "\\[").replace(/[\]]/, "\\]");
        var regex = new RegExp("[\\?&]" + name + "=([^&#]*)"),
            results = regex.exec(window.location.search);
        return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));
    }

    board.show_query_box = function (host, container) {
        var qb_container = $('#' + container);
        qb_container.addClass('query_box_container');

        // create a div inside the container to hold the form stuff
        qb_div = $(document.createElement('div'));
        qb_div.addClass('query_box');
        qb_div.appendTo(qb_container);

        var title = $(document.createElement('div'));
        title.html('3rd Party CI Scoreboard');
        title.addClass('query_box_title');
        title.appendTo(qb_div);

        current_project = get_param_by_name('project');
        current_user = get_param_by_name('user');
        current_timeframe = get_param_by_name('timeframe');

        var form = $(document.createElement('form'));

        add_input_to_form(form, 'Project Name', 'project', current_project);
        add_input_to_form(form, 'CI Account Username', 'user', current_user);
        add_input_to_form(form, 'Timeframe (hours)', 'timeframe', current_timeframe);
        // TODO: Implement the "start" and "count" filters so we can do pagination

        submit_button = $('<input/>', { type:'submit', value:'GO!'});
        submit_button.appendTo(form);
        form.submit(function(){
            location.href = '/' + $(this).serialize();
        });

        form.appendTo(qb_div);
    }

    board.build = function (host, container) {
        hostname = host;
        table_div_id = container;
        gather_data_and_build();
    };

    return board;
})();